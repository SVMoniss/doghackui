/**
 * Seeds the demo organism (mesh pipeline fixture) into the self-host Postgres.
 *
 * Uses the real engines (manifest verification, claim statuses, anomaly
 * classification) so the fixture is produced by the same code the app runs.
 *
 * Usage: DATABASE_URL=postgres://openjudge:change-me@localhost:5432/openjudge \
 *   npx tsx mesh/seed-organism.ts
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";

import { classifyAnomalies, deriveClaimStatus } from "../src/lib/engine/evidence";
import { recomputeMerkleRoot, verifyPayloadSignature } from "../src/lib/engine/manifest";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const MANIFEST_ID = "66666666-6666-6666-6666-666666666666";
const SUB_A = "55555555-0000-0000-0000-000000000001";
const SUB_B = "55555555-0000-0000-0000-000000000002";
const SUB_C = "55555555-0000-0000-0000-000000000003";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

async function main() {
  const manifest = JSON.parse(readFileSync("mesh/fixture-manifest.json", "utf8"));
  const key = JSON.parse(readFileSync("mesh/fixture-agent.key", "utf8"));

  // Verify the fixture the same way ingestManifest would.
  if (recomputeMerkleRoot(manifest) !== manifest.merkleRoot) {
    throw new Error("Fixture manifest Merkle root does not match.");
  }
  const { signingPayload } = await import("../src/lib/engine/manifest");
  if (!verifyPayloadSignature(signingPayload(manifest), manifest.attestation.signature, key.publicKeyPem)) {
    throw new Error("Fixture manifest signature is invalid.");
  }

  await pool.query("delete from public.organism_manifests where submission_id = $1", [SUB_A]);
  await pool.query(
    "delete from public.criterion_assessments where event_id = $1 and submission_id = any ($2)",
    [EVENT_ID, [SUB_A, SUB_B, SUB_C]],
  );
  await pool.query(
    "delete from public.eligibility_decisions where event_id = $1 and submission_id = any ($2)",
    [EVENT_ID, [SUB_A, SUB_B, SUB_C]],
  );

  const { rows } = await pool.query(
    `insert into public.organism_manifests
       (id, submission_id, event_id, owner_key, project_ref, team_ref, manifest, merkle_root,
        public_key, public_key_id, agent_version, sealed, sealed_at)
     values ($1, $2, $3, 'seed', $4, 'Null Pointers', $5, $6, $7, $8, $9, true, now())
     returning id`,
    [
      MANIFEST_ID,
      SUB_A,
      EVENT_ID,
      manifest.projectId,
      JSON.stringify(manifest),
      manifest.merkleRoot,
      key.publicKeyPem,
      manifest.attestation.publicKeyId,
      manifest.attestation.agentVersion,
    ],
  );
  const manifestId = (rows[0] as { id: string }).id;

  for (const claim of manifest.claims) {
    await pool.query(
      `insert into public.organism_claims
         (manifest_id, claim_id, statement, category, expected_evidence, evidence_refs, status)
       values ($1, $2, $3, $4, $5, $6, 'UNVERIFIED')`,
      [manifestId, claim.id, claim.statement, claim.category, claim.expectedEvidence, claim.evidenceRefs],
    );
  }
  for (const artifact of manifest.artifacts) {
    await pool.query(
      `insert into public.evidence_artifacts
         (manifest_id, artifact_id, kind, content_hash, uri, artifact_created_at, provenance)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        manifestId,
        artifact.id,
        artifact.kind,
        artifact.contentHash,
        artifact.uri,
        artifact.createdAt,
        JSON.stringify(artifact.provenance),
      ],
    );
  }

  // Demo claim-evidence links: two supported, one partial, one contradicted
  // (a live dispute for judges to acknowledge), one left unverified.
  const links = [
    { claim: "core_flow_runs", evidence: "replay_capsule_001", rel: "SUPPORTS", conf: 0.9, why: "Capsule declares the cold-start scenario for the core flow." },
    { claim: "offline_operation", evidence: "replay_capsule_001", rel: "SUPPORTS", conf: 0.96, why: "No external hosts referenced; offline replay declared." },
    { claim: "dependency_review", evidence: "dependency_graph_001", rel: "PARTIALLY_SUPPORTS", conf: 0.7, why: "Dependencies declared, but no security scan is attached yet." },
    { claim: "test_coverage_claim", evidence: "test_report_001", rel: "CONTRADICTS", conf: 0.88, why: "Demo dispute: the report lists one file, but the claim text overstates linked coverage." },
  ];
  // Context links for participant-attached trace/scene files (informative only).
  const attached = (manifest.artifacts as { id: string; kind: string }[]).filter((a) =>
    ["interaction_trace", "spatial_demo_scene"].includes(a.kind),
  );
  const contextTargets: Record<string, string> = {
    interaction_trace: "core_flow_runs",
    spatial_demo_scene: "impact_statement",
  };
  for (const link of links) {
    await pool.query(
      `insert into public.claim_links (manifest_id, claim_id, evidence_id, relationship, confidence, explanation)
       values ($1, $2, $3, $4, $5, $6)`,
      [manifestId, link.claim, link.evidence, link.rel, link.conf, link.why],
    );
  }
  for (const artifact of attached) {
    const target = contextTargets[artifact.kind];
    if (!target) continue;
    await pool.query(
      `insert into public.claim_links (manifest_id, claim_id, evidence_id, relationship, confidence, explanation)
       values ($1, $2, $3, 'CONTEXT', 0.6, $4)`,
      [manifestId, target, artifact.id, `Participant-supplied ${artifact.kind} for context.`],
    );
  }

  // Refresh claim statuses from the links, exactly like the server does.
  const claimRows = (await pool.query("select claim_id from public.organism_claims where manifest_id = $1", [manifestId])).rows;
  const linkRows = (await pool.query("select claim_id, relationship from public.claim_links where manifest_id = $1", [manifestId])).rows;
  for (const claim of claimRows as { claim_id: string }[]) {
    const status = deriveClaimStatus(
      (linkRows as { claim_id: string; relationship: "SUPPORTS" }[])
        .filter((l) => l.claim_id === claim.claim_id)
        .map((l) => ({ relationship: l.relationship })),
    );
    await pool.query("update public.organism_claims set status = $1 where manifest_id = $2 and claim_id = $3", [
      status,
      manifestId,
      claim.claim_id,
    ]);
  }

  // One passing replay run for the cold-start scenario.
  await pool.query(
    `insert into public.replay_runs (manifest_id, scenario_id, status, steps, report, submitted_by, started_at, finished_at)
     values ($1, 'cold_start', 'passed', $2, $3, 'seed', now(), now())`,
    [
      manifestId,
      JSON.stringify([
        { id: "st-startup", ok: true, detail: "exit code 0", durationMs: 1200 },
        { id: "st-table-0", ok: true, detail: "schema declaration recorded (agent-side check)", durationMs: 5 },
      ]),
      JSON.stringify({ fixture: true }),
    ],
  );

  // Anomalies from the real classifier.
  const anomalies = classifyAnomalies({
    claims: (
      await pool.query("select claim_id, status, category from public.organism_claims where manifest_id = $1", [manifestId])
    ).rows.map((c: { claim_id: string; status: "SUPPORTED"; category: string }) => ({
      id: c.claim_id,
      status: c.status,
      category: c.category,
    })),
    links: (
      await pool.query("select claim_id, evidence_id, relationship, confidence, explanation from public.claim_links where manifest_id = $1", [manifestId])
    ).rows.map((l: { claim_id: string; evidence_id: string; relationship: "SUPPORTS"; confidence: string; explanation: string }) => ({
      claimId: l.claim_id,
      evidenceId: l.evidence_id,
      relationship: l.relationship,
      confidence: Number(l.confidence),
      explanation: l.explanation,
    })),
    artifactKinds: (manifest.artifacts as { kind: string }[]).map((a) => a.kind),
    replayExists: true,
    replaySucceeded: true,
    hasSecurityEvidence: false,
    hasAccessibilityEvidence: false,
  });
  for (const anomaly of anomalies) {
    await pool.query(
      `insert into public.organism_anomalies
         (manifest_id, anomaly_key, severity, category, finding, confidence, evidence_refs, allowed_actions)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [manifestId, anomaly.id, anomaly.severity, anomaly.category, anomaly.finding, anomaly.confidence, anomaly.evidenceRefs, anomaly.allowedActions],
    );
  }

  // Assessments: A wins big with one assessor but loses narrowly to B with
  // two others — raw average crowns A while the other rules prefer B.
  const assessments: { assessor: string; submission: string; scores: Record<string, number> }[] = [];
  const full = (v: number) => ({
    impact: v,
    innovation: v,
    technical_execution: v,
    design: v,
    presentation_evidence: v,
  });
  assessments.push({ assessor: "seed-judge-a", submission: SUB_A, scores: full(10) });
  assessments.push({ assessor: "seed-judge-a", submission: SUB_B, scores: full(1) });
  assessments.push({ assessor: "seed-judge-a", submission: SUB_C, scores: full(5) });
  for (const assessor of ["seed-judge-b", "seed-judge-c"]) {
    assessments.push({ assessor, submission: SUB_A, scores: full(5) });
    assessments.push({ assessor, submission: SUB_B, scores: full(6) });
    assessments.push({ assessor, submission: SUB_C, scores: full(4) });
  }
  for (const a of assessments) {
    for (const [criterion, score] of Object.entries(a.scores)) {
      await pool.query(
        `insert into public.criterion_assessments
           (event_id, submission_id, assessor_key, criterion, score, confidence, rationale, evidence_refs, acknowledged_flags)
         values ($1, $2, $3, $4, $5, 4, $6, $7, $8)`,
        [
          EVENT_ID,
          a.submission,
          a.assessor,
          criterion,
          score,
          `Seeded rationale for ${criterion}: scores reflect the fixture review narrative.`,
          a.submission === SUB_A ? ["replay_capsule_001"] : [],
          a.submission === SUB_A ? ["contradicted:test_coverage_claim", "replay-failed"] : [],
        ],
      );
    }
  }

  await pool.query(
    `insert into public.eligibility_decisions (event_id, submission_id, status, reason, decided_by, decided_at)
     values ($1, $2, 'ELIGIBLE', '', 'seed', now())`,
    [EVENT_ID, SUB_A],
  );
  await pool.query(
    `insert into public.eligibility_decisions (event_id, submission_id, status, reason, decided_by, decided_at)
     values ($1, $2, 'PROVISIONAL', 'License declaration pending organizer confirmation.', 'seed', now())`,
    [EVENT_ID, SUB_B],
  );

  console.log(`Seeded organism ${manifestId} for submission ${SUB_A}`);
  console.log(`Claims, links, replay run, ${anomalies.length} anomalies, assessments, eligibility inserted.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
