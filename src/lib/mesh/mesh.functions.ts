import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "../auth/require-auth";

import {
  CRITERION_IDS,
  WEIGHTS,
  assessmentsToReviews,
  calculateJudgeProjectScore,
  rubricCriteria,
  validateAssessment,
  type CriterionId,
} from "../engine/scoring";
import {
  buildEvidenceCertificate,
  type EligibilityStatus,
} from "../engine/certificate";
import {
  classifyAnomalies,
  deriveClaimStatus,
  evidenceSignal,
  evidenceSufficiencyIndex,
  evidenceTarget,
  type ClaimEvidenceLink,
} from "../engine/evidence";
import {
  canonicalJson,
  MODALITIES,
  recomputeMerkleRoot,
  sha256Hex,
  signingPayload,
  validateManifest,
  verifyPayloadSignature,
  type ProjectManifest,
} from "../engine/manifest";
import { meshPool } from "./db";
import { logAudit } from "./audit";

const uuid = z.string().uuid();

/* ---------- shared helpers (server only) ---------- */

type ManifestRow = {
  id: string;
  submission_id: string | null;
  event_id: string | null;
  owner_key: string;
  project_ref: string;
  team_ref: string;
  manifest: ProjectManifest;
  merkle_root: string;
  public_key: string;
  public_key_id: string;
  agent_version: string;
  sealed: boolean;
  sealed_at: string | null;
  created_at: string;
};

async function loadManifestRow(manifestId: string): Promise<ManifestRow | null> {
  const { rows } = await meshPool().query("select * from public.organism_manifests where id = $1", [
    manifestId,
  ]);
  const row = rows[0] as ManifestRow | undefined;
  return row ?? null;
}

async function requireOwnedManifest(manifestId: string, userId: string): Promise<ManifestRow> {
  const row = await loadManifestRow(manifestId);
  if (!row) throw new Error("Organism not found.");
  if (row.owner_key !== userId) throw new Error("Forbidden: this organism belongs to another team.");
  if (row.sealed) throw new Error("This submission is sealed and can no longer change.");
  return row;
}

function astCounts(manifest: ProjectManifest): { nodes: number; endpoints: number } {
  const graph = (manifest as unknown as Record<string, unknown>)["astGraph"] as
    | { nodes?: { kind?: string }[] }
    | undefined;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
  const endpoints = Array.isArray(graph?.nodes)
    ? graph.nodes.filter((n) => n.kind === "endpoint").length
    : 0;
  return { nodes, endpoints };
}

/**
 * Evidence components, derived deterministically from stored rows so the
 * sufficiency story is always reproducible from the same inputs.
 */
export function organismEvidenceComponents(input: {
  manifest: ProjectManifest;
  claims: { id: string; links: number }[];
  artifactKinds: string[];
  runs: { scenario_id: string; status: string }[];
}): { test: number; replay: number; docs: number; security: number } {
  const test = input.artifactKinds.includes("test_report") ? 0.8 : 0.2;
  let replay = 0;
  if (input.runs.length > 0) {
    const latest = new Map<string, string>();
    for (const run of input.runs) latest.set(run.scenario_id, run.status);
    const states = [...latest.values()];
    replay = states.filter((s) => s === "passed").length / states.length;
  }
  const docs = input.claims.length === 0 ? 0 : input.claims.filter((c) => c.links > 0).length / input.claims.length;
  const security = input.artifactKinds.includes("security_scan")
    ? 1
    : input.manifest.claims.some((c) => c.category === "security" || c.category === "privacy")
      ? 0.4
      : 0.6;
  return { test, replay, docs, security };
}

export function organismComplexity(input: {
  manifest: ProjectManifest;
}): { complexity: number; apiSurface: number; harm: number } {
  const { nodes, endpoints } = astCounts(input.manifest);
  return {
    complexity: Math.min(1, nodes / 150),
    apiSurface: Math.min(1, endpoints / 15),
    harm: input.manifest.claims.some((c) => c.category === "security" || c.category === "privacy")
      ? 0.7
      : 0.3,
  };
}

/** Recompute claim statuses from links and persist them. */
async function refreshClaimStatuses(manifestId: string): Promise<void> {
  const pool = meshPool();
  const { rows: claims } = await pool.query(
    "select claim_id from public.organism_claims where manifest_id = $1",
    [manifestId],
  );
  const { rows: links } = await pool.query(
    "select claim_id, relationship from public.claim_links where manifest_id = $1",
    [manifestId],
  );
  for (const claim of claims as { claim_id: string }[]) {
    const status = deriveClaimStatus(
      (links as { claim_id: string; relationship: ClaimEvidenceLink["relationship"] }[])
        .filter((l) => l.claim_id === claim.claim_id)
        .map((l) => ({ relationship: l.relationship })),
    );
    await pool.query(
      "update public.organism_claims set status = $1 where manifest_id = $2 and claim_id = $3",
      [status, manifestId, claim.claim_id],
    );
  }
}

/**
 * Reconcile stored anomalies with the current state: insert new findings,
 * refresh open ones, and auto-resolve open findings whose condition cleared.
 * Human resolutions (explained/waived) are never touched.
 */
async function syncAnomalies(manifestId: string): Promise<void> {
  const pool = meshPool();
  const manifestRow = await loadManifestRow(manifestId);
  if (!manifestRow) return;

  const [{ rows: claimRows }, { rows: linkRows }, { rows: artifactRows }, { rows: runRows }] =
    await Promise.all([
      pool.query("select claim_id, status, category from public.organism_claims where manifest_id = $1", [manifestId]),
      pool.query("select claim_id, evidence_id, relationship, confidence, explanation from public.claim_links where manifest_id = $1", [manifestId]),
      pool.query("select kind from public.evidence_artifacts where manifest_id = $1", [manifestId]),
      pool.query("select scenario_id, status from public.replay_runs where manifest_id = $1 order by created_at asc", [manifestId]),
    ]);

  const links = (linkRows as {
    claim_id: string;
    evidence_id: string;
    relationship: ClaimEvidenceLink["relationship"];
    confidence: number;
    explanation: string;
  }[]).map((l) => ({
    claimId: l.claim_id,
    evidenceId: l.evidence_id,
    relationship: l.relationship,
    confidence: Number(l.confidence),
    explanation: l.explanation,
  }));

  const latest = new Map<string, string>();
  for (const run of runRows as { scenario_id: string; status: string }[]) {
    latest.set(run.scenario_id, run.status);
  }
  const states = [...latest.values()];

  const found = classifyAnomalies({
    claims: (claimRows as { claim_id: string; status: string; category: string }[]).map((c) => ({
      id: c.claim_id,
      status: c.status as "SUPPORTED" | "PARTIAL" | "UNVERIFIED" | "CONTRADICTED",
      category: c.category,
    })),
    links,
    artifactKinds: (artifactRows as { kind: string }[]).map((a) => a.kind),
    replayExists: states.length > 0,
    replaySucceeded: states.length > 0 && states.every((s) => s === "passed"),
    hasSecurityEvidence: (artifactRows as { kind: string }[]).some((a) => a.kind === "security_scan"),
    hasAccessibilityEvidence: (artifactRows as { kind: string }[]).some((a) => a.kind === "accessibility_report"),
  });

  const keys = new Set<string>();
  for (const anomaly of found) {
    keys.add(anomaly.id);
    await pool.query(
      `insert into public.organism_anomalies
         (manifest_id, anomaly_key, severity, category, finding, confidence, evidence_refs, allowed_actions)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (manifest_id, anomaly_key) do nothing`,
      [manifestId, anomaly.id, anomaly.severity, anomaly.category, anomaly.finding, anomaly.confidence, anomaly.evidenceRefs, anomaly.allowedActions],
    );
    await pool.query(
      `update public.organism_anomalies
       set severity = $3, finding = $4, confidence = $5, evidence_refs = $6, allowed_actions = $7
       where manifest_id = $1 and anomaly_key = $2 and state = 'open'`,
      [manifestId, anomaly.id, anomaly.severity, anomaly.finding, anomaly.confidence, anomaly.evidenceRefs, anomaly.allowedActions],
    );
  }
  await pool.query(
    `update public.organism_anomalies
     set state = 'resolved', resolution = 'Condition cleared by new evidence.'
     where manifest_id = $1 and state = 'open' and not (anomaly_key = any ($2))`,
    [manifestId, [...keys]],
  );
}

/* ---------- public reads ---------- */

export const getOrganism = createServerFn({ method: "GET" })
  .inputValidator((input: { submissionId: string }) => z.object({ submissionId: uuid }).parse(input))
  .handler(async ({ data }) => {
    const pool = meshPool();
    const { rows } = await pool.query(
      "select * from public.organism_manifests where submission_id = $1 order by created_at desc limit 1",
      [data.submissionId],
    );
    const manifestRow = rows[0] as ManifestRow | undefined;
    if (!manifestRow) return { found: false as const };

    const manifestId = manifestRow.id;
    const [claimRes, artifactRes, linkRes, runRes, anomalyRes, assessmentRes, eligibilityRes, siblingRes] =
      await Promise.all([
        pool.query("select * from public.organism_claims where manifest_id = $1 order by claim_id", [manifestId]),
        pool.query("select * from public.evidence_artifacts where manifest_id = $1 order by artifact_id", [manifestId]),
        pool.query("select * from public.claim_links where manifest_id = $1 order by claim_id, evidence_id", [manifestId]),
        pool.query("select * from public.replay_runs where manifest_id = $1 order by created_at asc", [manifestId]),
        pool.query("select * from public.organism_anomalies where manifest_id = $1 order by created_at asc", [manifestId]),
        pool.query(
          "select assessor_key, criterion, score, confidence, rationale, evidence_refs, acknowledged_flags from public.criterion_assessments where event_id = $1 and submission_id = $2 order by assessor_key, criterion",
          [manifestRow.event_id, data.submissionId],
        ),
        pool.query(
          "select status, reason from public.eligibility_decisions where event_id = $1 and submission_id = $2",
          [manifestRow.event_id, data.submissionId],
        ),
        pool.query(
          "select distinct submission_id from public.criterion_assessments where event_id = $1",
          [manifestRow.event_id],
        ),
      ]);

    const claims = claimRes.rows as {
      claim_id: string;
      statement: string;
      category: string;
      expected_evidence: string[];
      evidence_refs: string[];
      status: string;
    }[];
    const artifactKinds = (artifactRes.rows as { kind: string }[]).map((a) => a.kind);
    const runs = runRes.rows as { scenario_id: string; status: string }[];

    const components = organismEvidenceComponents({
      manifest: manifestRow.manifest,
      claims: claims.map((c) => ({
        id: c.claim_id,
        links: (linkRes.rows as { claim_id: string }[]).filter((l) => l.claim_id === c.claim_id).length,
      })),
      artifactKinds,
      runs,
    });
    const complexity = organismComplexity({ manifest: manifestRow.manifest });
    const sufficiency = evidenceSufficiencyIndex({
      test: components.test,
      replay: components.replay,
      docs: components.docs,
      security: components.security,
    });
    const target = evidenceTarget(complexity);
    const signal = evidenceSignal(sufficiency, target);

    // Certificate over every assessed submission in the event, so all four
    // rules consume the same dataset.
    const assessedIds = (siblingRes.rows as { submission_id: string }[]).map((r) => r.submission_id);
    if (!assessedIds.includes(data.submissionId)) assessedIds.push(data.submissionId);
    assessedIds.sort();
    const { rows: allAssessments } = await pool.query(
      "select submission_id, assessor_key, criterion, score from public.criterion_assessments where event_id = $1",
      [manifestRow.event_id],
    );
    const byJudgeProject = new Map<string, Record<CriterionId, number>>();
    for (const row of allAssessments as { submission_id: string; assessor_key: string; criterion: string; score: number }[]) {
      const key = `${row.assessor_key}::${row.submission_id}`;
      const bucket = byJudgeProject.get(key) ?? ({} as Record<CriterionId, number>);
      if ((CRITERION_IDS as string[]).includes(row.criterion)) {
        bucket[row.criterion as CriterionId] = row.score;
      }
      byJudgeProject.set(key, bucket);
    }
    const completeSets = [...byJudgeProject.entries()]
      .filter(([, scores]) => CRITERION_IDS.every((id) => typeof scores[id] === "number"))
      .map(([key, scores]) => {
        const [judgeKey, submissionId] = key.split("::") as [string, string];
        return { judgeKey, submissionId, scores };
      });
    const certificate = buildEvidenceCertificate({
      criteria: rubricCriteria(),
      reviews: assessmentsToReviews(completeSets),
      submissionIds: assessedIds,
      projectId: data.submissionId,
      prizePositions: 3,
      eligibility: ((eligibilityRes.rows[0] as { status: string } | undefined)?.status ??
        "ELIGIBLE") as EligibilityStatus,
      evidence: {
        sufficiency,
        signal,
        verifiedClaims: claims.filter((c) => c.status === "SUPPORTED").length,
        partialClaims: claims.filter((c) => c.status === "PARTIAL").length,
        contradictedClaims: claims.filter((c) => c.status === "CONTRADICTED").length,
      },
    });

    const assessorLabels = anonymise(
      [...new Set((assessmentRes.rows as { assessor_key: string }[]).map((r) => r.assessor_key))].sort(),
    );

    // Six evidence modalities: what was captured and what a judge can inspect.
    const artifacts = artifactRes.rows as {
      artifact_id: string;
      kind: string;
      content_hash: string;
      uri: string;
      artifact_created_at: string | null;
      provenance: Record<string, unknown>;
    }[];
    const linkCount = (linkRes.rows as unknown[]).length;
    const modalities = MODALITIES.map((modality) => {
      let artifactIds: string[];
      if (modality.id === "replay") {
        // A capsule artifact or any recorded run satisfies the modality.
        artifactIds = artifacts
          .filter((a) => (modality.kinds as readonly string[]).includes(a.kind))
          .map((a) => a.artifact_id);
        if (artifactIds.length === 0 && runRes.rows.length > 0) {
          artifactIds = (runRes.rows as { scenario_id: string }[]).map(
            (r) => `replay run: ${r.scenario_id}`,
          );
        }
      } else if (modality.id === "graph") {
        artifactIds =
          claims.length > 0 && linkCount > 0
            ? (linkRes.rows as { evidence_id: string }[]).map((l) => l.evidence_id)
            : [];
      } else {
        artifactIds = artifacts
          .filter((a) => (modality.kinds as readonly string[]).includes(a.kind))
          .map((a) => a.artifact_id);
      }
      return {
        id: modality.id,
        title: modality.title,
        captures: modality.captures,
        judgeSees: modality.judgeSees,
        status: (artifactIds.length > 0 ? "present" : "missing") as "present" | "missing",
        artifactIds: [...new Set(artifactIds)],
      };
    });

    type AssessmentRow = {
      assessor_key: string;
      criterion: string;
      score: number;
      confidence: number;
      rationale: string;
      evidence_refs: string[];
      acknowledged_flags: string[];
    };

    return {
      found: true as const,
      manifest: manifestRow,
      claims: claimRes.rows,
      artifacts: artifactRes.rows,
      links: linkRes.rows,
      runs: runRes.rows,
      anomalies: anomalyRes.rows,
      assessments: (assessmentRes.rows as AssessmentRow[]).map((r) => ({
        criterion: r.criterion,
        score: Number(r.score),
        confidence: Number(r.confidence),
        rationale: r.rationale,
        evidenceRefs: r.evidence_refs,
        acknowledgedFlags: r.acknowledged_flags,
        assessorLabel: assessorLabels[r.assessor_key] ?? "Assessor",
      })),
      eligibility: (eligibilityRes.rows[0] as { status: string; reason: string } | undefined) ?? {
        status: "ELIGIBLE",
        reason: "",
      },
      evidence: { components, complexity, sufficiency, target, signal },
      modalities,
      certificate,
      rubric: { version: "rubric-v1", weights: WEIGHTS },
    };
  });

function anonymise(keys: string[]): Record<string, string> {
  return Object.fromEntries(
    keys.map((key, index) => [key, `Assessor ${String.fromCharCode(65 + (index % 26))}`]),
  );
}

export type OrganismPayload = Awaited<ReturnType<typeof getOrganism>>;

/* ---------- authenticated writes ---------- */

const manifestJson = z.unknown();

export const ingestManifest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ manifest: manifestJson, publicKeyPem: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const errors = validateManifest(data.manifest);
    if (errors.length > 0) throw new Error(`Invalid manifest: ${errors[0]}`);
    const manifest = data.manifest as ProjectManifest;

    if (recomputeMerkleRoot(manifest) !== manifest.merkleRoot) {
      throw new Error("Merkle root mismatch: the artifacts do not match the sealed root.");
    }
    const keyId = sha256Hex(data.publicKeyPem).slice(0, 16);
    if (keyId !== manifest.attestation.publicKeyId) {
      throw new Error("Public key does not match the manifest attestation.");
    }
    if (!verifyPayloadSignature(signingPayload(manifest), manifest.attestation.signature, data.publicKeyPem)) {
      throw new Error("Invalid attestation signature.");
    }

    const pool = meshPool();
    const { rows } = await pool.query(
      `insert into public.organism_manifests
         (submission_id, event_id, owner_key, project_ref, team_ref, manifest, merkle_root, public_key, public_key_id, agent_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        manifest.submissionId,
        manifest.eventId,
        context.userId,
        manifest.projectId,
        manifest.teamId,
        JSON.stringify(manifest),
        manifest.merkleRoot,
        data.publicKeyPem,
        manifest.attestation.publicKeyId,
        manifest.attestation.agentVersion,
      ],
    );
    const manifestId = (rows[0] as { id: string }).id;

    for (const claim of manifest.claims) {
      await pool.query(
        `insert into public.organism_claims
           (manifest_id, claim_id, statement, category, expected_evidence, evidence_refs, status)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [manifestId, claim.id, claim.statement, claim.category, claim.expectedEvidence, claim.evidenceRefs, "UNVERIFIED"],
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

    await syncAnomalies(manifestId);
    const { rows: anomalyRows } = await pool.query(
      "select count(*) as count from public.organism_anomalies where manifest_id = $1 and state = 'open'",
      [manifestId],
    );
    await logAudit({
      eventId: manifest.eventId,
      actor: context.userId,
      action: "organism.ingested",
      entity: "organism_manifests",
      entityId: manifestId,
      detail: { merkleRoot: manifest.merkleRoot, claims: manifest.claims.length },
    });

    return {
      manifestId,
      merkleRoot: manifest.merkleRoot,
      pairingCode: manifest.merkleRoot.slice(0, 12),
      claimCount: manifest.claims.length,
      artifactCount: manifest.artifacts.length,
      openAnomalies: Number((anomalyRows[0] as { count: string }).count),
    };
  });

export const myOrganisms = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { rows } = await meshPool().query(
      `select m.id, m.submission_id, m.event_id, m.project_ref, m.team_ref, m.merkle_root,
              m.sealed, m.sealed_at, m.created_at,
              (select count(*) from public.organism_claims c where c.manifest_id = m.id) as claims,
              (select count(*) from public.organism_anomalies a where a.manifest_id = m.id and a.state = 'open') as open_anomalies
       from public.organism_manifests m
       where m.owner_key = $1
       order by m.created_at desc`,
      [context.userId],
    );
    return rows;
  });

export const createClaim = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        manifestId: uuid,
        statement: z.string().trim().min(10).max(500),
        category: z.enum([
          "core_functionality",
          "impact",
          "security",
          "privacy",
          "accessibility",
          "deployment",
          "performance",
        ]),
        expectedEvidence: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireOwnedManifest(data.manifestId, context.userId);
    const claimId = `claim-${sha256Hex(`${data.manifestId}:${data.statement}`).slice(0, 8)}`;
    const pool = meshPool();
    const { rows } = await pool.query(
      `insert into public.organism_claims (manifest_id, claim_id, statement, category, expected_evidence, status)
       values ($1, $2, $3, $4, $5, 'UNVERIFIED')
       on conflict (manifest_id, claim_id) do nothing
       returning claim_id`,
      [data.manifestId, claimId, data.statement, data.category, data.expectedEvidence],
    );
    await syncAnomalies(data.manifestId);
    return { claimId: (rows[0] as { claim_id: string } | undefined)?.claim_id ?? claimId };
  });

export const addClaimLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        manifestId: uuid,
        claimId: z.string().min(1).max(120),
        evidenceId: z.string().min(1).max(120),
        relationship: z.enum(["SUPPORTS", "PARTIALLY_SUPPORTS", "CONTRADICTS", "CONTEXT"]),
        confidence: z.number().min(0).max(1),
        explanation: z.string().trim().min(10).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireOwnedManifest(data.manifestId, context.userId);
    const pool = meshPool();
    const [claim, artifact] = await Promise.all([
      pool.query("select 1 from public.organism_claims where manifest_id = $1 and claim_id = $2", [data.manifestId, data.claimId]),
      pool.query("select 1 from public.evidence_artifacts where manifest_id = $1 and artifact_id = $2", [data.manifestId, data.evidenceId]),
    ]);
    if (claim.rows.length === 0) throw new Error("Unknown claim.");
    if (artifact.rows.length === 0) throw new Error("Unknown evidence artifact.");
    await pool.query(
      `insert into public.claim_links (manifest_id, claim_id, evidence_id, relationship, confidence, explanation)
       values ($1, $2, $3, $4, $5, $6)`,
      [data.manifestId, data.claimId, data.evidenceId, data.relationship, data.confidence, data.explanation],
    );
    await refreshClaimStatuses(data.manifestId);
    await syncAnomalies(data.manifestId);
    return { ok: true };
  });

const replayReportSchema = z.object({
  results: z
    .array(
      z.object({
        manifestMerkle: z.string().min(1),
        submissionId: z.string().min(1),
        scenarioId: z.string().min(1),
        passed: z.boolean(),
        steps: z.array(
          z.object({
            id: z.string(),
            ok: z.boolean(),
            detail: z.string(),
            durationMs: z.number(),
          }),
        ),
        ranAt: z.string(),
        agentVersion: z.string(),
      }),
    )
    .min(1),
  attestation: z.object({
    algorithm: z.literal("ed25519"),
    publicKeyId: z.string().min(1),
    signature: z.string().min(1),
    agentVersion: z.string().min(1),
  }),
});

export const submitReplayRun = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ manifestId: uuid, report: replayReportSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const manifestRow = await requireOwnedManifest(data.manifestId, context.userId);
    const manifest = manifestRow.manifest;

    if (data.report.attestation.publicKeyId !== manifestRow.public_key_id) {
      throw new Error("Replay report is signed by a different agent key than the manifest.");
    }
    const payload = canonicalJson({ results: data.report.results });
    if (!verifyPayloadSignature(payload, data.report.attestation.signature, manifestRow.public_key)) {
      throw new Error("Invalid replay report signature.");
    }

    const pool = meshPool();
    const scenarios = new Map(manifest.environment.scenarios.map((s) => [s.id, s]));
    const runIds: string[] = [];
    for (const result of data.report.results) {
      if (result.manifestMerkle !== manifestRow.merkle_root) {
        throw new Error(`Replay report targets a different manifest (${result.scenarioId}).`);
      }
      const scenario = scenarios.get(result.scenarioId);
      if (!scenario) throw new Error(`Unknown scenario "${result.scenarioId}".`);

      const artifactId = `replay_run_${result.scenarioId}_${sha256Hex(payload + result.scenarioId).slice(0, 8)}`;
      await pool.query(
        `insert into public.evidence_artifacts
           (manifest_id, artifact_id, kind, content_hash, uri, artifact_created_at, provenance)
         values ($1, $2, 'runtime_trace', $3, $4, $5, $6)
         on conflict (manifest_id, artifact_id) do nothing`,
        [
          data.manifestId,
          artifactId,
          sha256Hex(canonicalJson(result)),
          `mesh-agent:replay/${result.scenarioId}`,
          result.ranAt,
          JSON.stringify({ producer: "mesh-agent", trusted: true }),
        ],
      );

      const { rows } = await pool.query(
        `insert into public.replay_runs
           (manifest_id, scenario_id, status, steps, report, submitted_by, started_at, finished_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          data.manifestId,
          result.scenarioId,
          result.passed ? "passed" : "failed",
          JSON.stringify(result.steps),
          JSON.stringify(result),
          context.userId,
          result.ranAt,
          result.ranAt,
        ],
      );
      runIds.push((rows[0] as { id: string }).id);

      const passedRatio =
        result.steps.length === 0 ? 0 : result.steps.filter((s) => s.ok).length / result.steps.length;
      for (const claimId of scenario.claimRefs) {
        await pool.query(
          `insert into public.claim_links (manifest_id, claim_id, evidence_id, relationship, confidence, explanation)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            data.manifestId,
            claimId,
            artifactId,
            result.passed ? "SUPPORTS" : "CONTRADICTS",
            result.passed ? Math.max(0.5, passedRatio) : 0.9,
            result.passed
              ? `Replay scenario "${result.scenarioId}" passed (${result.steps.filter((s) => s.ok).length}/${result.steps.length} steps).`
              : `Replay scenario "${result.scenarioId}" failed: ${result.steps.find((s) => !s.ok)?.detail ?? "see run"}.`,
          ],
        );
      }
    }

    await refreshClaimStatuses(data.manifestId);
    await syncAnomalies(data.manifestId);
    return { runIds };
  });

export const resolveAnomaly = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        anomalyId: uuid,
        action: z.enum(["EXPLAIN", "ATTACH_EVIDENCE", "WAIVE", "RETRY"]),
        note: z.string().trim().max(1000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows } = await pool.query("select * from public.organism_anomalies where id = $1", [data.anomalyId]);
    const anomaly = rows[0] as
      | { manifest_id: string; state: string; allowed_actions: string[] }
      | undefined;
    if (!anomaly) throw new Error("Anomaly not found.");
    await requireOwnedManifest(anomaly.manifest_id, context.userId);
    if (anomaly.state !== "open") throw new Error("This anomaly is already resolved.");
    if (!anomaly.allowed_actions.includes(data.action)) {
      throw new Error(`Action ${data.action} is not allowed for this finding.`);
    }
    if ((data.action === "WAIVE" || data.action === "EXPLAIN") && data.note.length < 10) {
      throw new Error("A rationale of at least 10 characters is required.");
    }
    const state = data.action === "RETRY" ? "open" : data.action === "WAIVE" ? "waived" : data.action === "EXPLAIN" ? "explained" : "resolved";
    await pool.query(
      "update public.organism_anomalies set state = $1, resolution = $2, resolved_by = $3, resolved_at = now() where id = $4",
      [state, data.note || `${data.action} requested`, context.userId, data.anomalyId],
    );
    return { ok: true, state };
  });

const assessmentSchema = z.object({
  criterion: z.string(),
  score: z.number().int().min(1).max(10),
  confidence: z.number().int().min(1).max(5),
  rationale: z.string().trim().min(10).max(2000),
  evidenceRefs: z.array(z.string()).default([]),
  acknowledgedFlags: z.array(z.string()).default([]),
});

export const submitAssessments = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: uuid,
        submissionId: uuid,
        assessments: z.array(assessmentSchema).length(5),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const seen = new Set(data.assessments.map((a) => a.criterion));
    if (seen.size !== 5 || !CRITERION_IDS.every((id) => seen.has(id))) {
      throw new Error("All five rubric criteria must be assessed exactly once.");
    }
    for (const assessment of data.assessments) {
      const errors = validateAssessment(assessment);
      if (errors.length > 0) throw new Error(`${assessment.criterion}: ${errors[0]}`);
    }

    // Cross-metric gates: contradicted claims and failed replays must be
    // acknowledged, and a failed replay caps Technical Execution at 4/10
    // unless the judge records it as environmental.
    const pool = meshPool();
    const { rows: manifestRows } = await pool.query(
      "select id from public.organism_manifests where submission_id = $1 order by created_at desc limit 1",
      [data.submissionId],
    );
    const manifestId = (manifestRows[0] as { id: string } | undefined)?.id;
    const flags = new Set(data.assessments.flatMap((a) => a.acknowledgedFlags));

    if (manifestId) {
      const [{ rows: contradicted }, { rows: failedRuns }] = await Promise.all([
        pool.query(
          "select claim_id from public.organism_claims where manifest_id = $1 and status = 'CONTRADICTED'",
          [manifestId],
        ),
        pool.query(
          `select scenario_id from public.replay_runs where manifest_id = $1 and status = 'failed'
           and created_at = (select max(created_at) from public.replay_runs r2 where r2.manifest_id = $1 and r2.scenario_id = public.replay_runs.scenario_id)`,
          [manifestId],
        ),
      ]);
      for (const row of contradicted as { claim_id: string }[]) {
        if (!flags.has(`contradicted:${row.claim_id}`)) {
          throw new Error(`Claim "${row.claim_id}" is contradicted — acknowledge it before submitting.`);
        }
      }
      const tech = data.assessments.find((a) => a.criterion === "technical_execution")!;
      for (const row of failedRuns as { scenario_id: string }[]) {
        if (!flags.has("replay-failed")) {
          throw new Error(`Replay scenario "${row.scenario_id}" failed — acknowledge it before submitting.`);
        }
        if (tech.score > 4 && !flags.has(`env-override:${row.scenario_id}`)) {
          throw new Error(
            `Technical Execution cannot exceed 4/10 while replay "${row.scenario_id}" fails, unless recorded as environmental.`,
          );
        }
      }
    }

    for (const assessment of data.assessments) {
      await pool.query(
        `insert into public.criterion_assessments
           (event_id, submission_id, assessor_key, criterion, score, confidence, rationale, evidence_refs, acknowledged_flags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (event_id, submission_id, assessor_key, criterion)
         do update set score = excluded.score, confidence = excluded.confidence, rationale = excluded.rationale,
           evidence_refs = excluded.evidence_refs, acknowledged_flags = excluded.acknowledged_flags`,
        [
          data.eventId,
          data.submissionId,
          context.userId,
          assessment.criterion,
          assessment.score,
          assessment.confidence,
          assessment.rationale,
          assessment.evidenceRefs,
          assessment.acknowledgedFlags,
        ],
      );
    }

    const scores = Object.fromEntries(
      data.assessments.map((a) => [a.criterion, a.score]),
    ) as Record<CriterionId, number>;
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "assessment.submitted",
      entity: "submissions",
      entityId: data.submissionId,
      detail: { criteria: data.assessments.length },
    });
    return { ok: true, projectScore: Math.round(calculateJudgeProjectScore(scores) * 100) / 100 };
  });

export const setEligibility = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: uuid,
        submissionId: uuid,
        status: z.enum(["ELIGIBLE", "PROVISIONAL", "INELIGIBLE", "MANUAL_REVIEW_REQUIRED"]),
        reason: z.string().trim().max(1000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { rows: roleRows } = await meshPool().query(
      "select 1 from public.user_roles where user_id = $1 and role = 'organizer'",
      [context.userId],
    );
    if (roleRows.length === 0) throw new Error("Forbidden: organizers only.");
    if (data.status !== "ELIGIBLE" && data.reason.length < 10) {
      throw new Error("A reason of at least 10 characters is required for non-eligible decisions.");
    }
    await meshPool().query(
      `insert into public.eligibility_decisions (event_id, submission_id, status, reason, decided_by, decided_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (event_id, submission_id)
       do update set status = excluded.status, reason = excluded.reason, decided_by = excluded.decided_by, decided_at = now()`,
      [data.eventId, data.submissionId, data.status, data.reason, context.userId],
    );
    await logAudit({
      eventId: data.eventId,
      actor: context.userId,
      action: "eligibility.decided",
      entity: "submissions",
      entityId: data.submissionId,
      detail: { status: data.status },
    });
    const { triggerWebhooks } = await import("./webhooks");
    await triggerWebhooks("eligibility.decided", {
      eventId: data.eventId,
      submissionId: data.submissionId,
      status: data.status,
    });
    return { ok: true };
  });

export const sealOrganism = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ manifestId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const pool = meshPool();
    const { rows } = await pool.query("select * from public.organism_manifests where id = $1", [data.manifestId]);
    const row = rows[0] as ManifestRow | undefined;
    if (!row) throw new Error("Organism not found.");
    if (row.owner_key !== context.userId) throw new Error("Forbidden: this organism belongs to another team.");
    if (row.sealed) throw new Error("Already sealed.");

    const [{ rows: claimRows }, { rows: openRows }, { rows: eligibilityRows }] = await Promise.all([
      pool.query("select status from public.organism_claims where manifest_id = $1", [data.manifestId]),
      pool.query("select count(*) as count from public.organism_anomalies where manifest_id = $1 and state = 'open'", [data.manifestId]),
      pool.query("select status from public.eligibility_decisions where event_id = $1 and submission_id = $2", [row.event_id, row.submission_id]),
    ]);
    if ((claimRows as { status: string }[]).length === 0) {
      throw new Error("Add at least one claim before sealing.");
    }

    await pool.query("update public.organism_manifests set sealed = true, sealed_at = now() where id = $1", [data.manifestId]);

    const summary = {
      manifestId: data.manifestId,
      submissionId: row.submission_id,
      merkleRoot: row.merkle_root,
      claimCount: claimRows.length,
      openAnomalies: Number((openRows[0] as { count: string }).count),
      eligibility: ((eligibilityRows[0] as { status: string } | undefined)?.status ?? "ELIGIBLE") as EligibilityStatus,
      sealedBy: context.userId,
    };
    const receiptId = sha256Hex(canonicalJson(summary));
    return { ...summary, receiptId };
  });
