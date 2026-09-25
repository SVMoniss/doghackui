/**
 * OpenJudge Mesh submission protocol: the signed project manifest.
 *
 * The mesh agent analyzes a project locally and submits a manifest that
 * references evidence by content hash — never by uploading secrets, source
 * code, environment files, or private developer activity.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

export type ClaimCategory =
  | "core_functionality"
  | "impact"
  | "security"
  | "privacy"
  | "accessibility"
  | "deployment"
  | "performance";

export type ClaimStatus = "SUPPORTED" | "PARTIAL" | "UNVERIFIED" | "CONTRADICTED";

export type ProjectClaim = {
  id: string;
  statement: string;
  category: ClaimCategory;
  expectedEvidence: string[];
  evidenceRefs: string[];
  status: ClaimStatus;
};

export type EvidenceKind =
  | "ast_snapshot"
  | "dependency_graph"
  | "replay_capsule"
  | "test_report"
  | "runtime_trace"
  | "interaction_recording"
  | "interaction_trace"
  | "spatial_demo_scene"
  | "accessibility_report"
  | "security_scan"
  | "documentation_snapshot"
  | "milestone_attestation";

export type EvidenceArtifact = {
  id: string;
  kind: EvidenceKind;
  contentHash: string;
  uri: string;
  createdAt: string;
  provenance: {
    producer: "mesh-agent" | "participant" | "organizer-suite";
    sourceRef?: string;
    trusted: boolean;
  };
};

export type ReplayCheck = {
  id: string;
  kind: "startup" | "health" | "scenario" | "offline" | "role_isolation" | "accessibility";
  target: string;
  expectation: string;
};

export type ReplayStep = {
  id: string;
  kind: "file" | "http" | "command";
  target: string;
  expectation: string;
};

export type ReplayScenario = {
  id: string;
  title: string;
  steps: ReplayStep[];
  expectedOutcome: string;
  claimRefs: string[];
};

export type ReplayEnvironment = {
  runtime: "docker-compose" | "container" | "native";
  startupCommand: string;
  healthChecks: ReplayCheck[];
  scenarios: ReplayScenario[];
  networkPolicy: "offline" | "allowlisted" | "networked";
};

export type PolicyDeclaration = {
  type: "license" | "offline_capable" | "no_secrets_uploaded" | "privacy" | "custom";
  statement: string;
};

export type ManifestAttestation = {
  algorithm: "ed25519";
  publicKeyId: string;
  signature: string;
  agentVersion: string;
};

export type ProjectManifest = {
  schemaVersion: "1.0";
  submissionId: string;
  eventId: string;
  projectId: string;
  teamId: string;
  sealedAt: string;
  merkleRoot: string;
  attestation: ManifestAttestation;
  claims: ProjectClaim[];
  artifacts: EvidenceArtifact[];
  environment: ReplayEnvironment;
  policyDeclarations: PolicyDeclaration[];
};

export type ASTNode = {
  id: string;
  kind: "module" | "function" | "class" | "endpoint" | "table" | "test";
  label: string;
  sourceRef: string;
  complexity?: number;
  tags: string[];
};

export type ASTEdge = {
  source: string;
  target: string;
  kind: "imports" | "calls" | "reads" | "writes" | "tests" | "authenticates";
};

/** Deterministic JSON: sorted object keys, applied recursively. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Hash of one artifact's identity: kind + id + content hash. */
export function artifactLeafHash(artifact: Pick<EvidenceArtifact, "id" | "kind" | "contentHash">): string {
  return sha256Hex(canonicalJson({ kind: artifact.kind, id: artifact.id, contentHash: artifact.contentHash }));
}

/**
 * Merkle root over artifact leaf hashes (sorted for determinism; the odd
 * leaf is duplicated). Empty set hashes a fixed domain tag.
 */
export function merkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) return sha256Hex("openjudge:empty-manifest");
  let level = leafHashes.slice().sort();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(sha256Hex(`${left}${right}`));
    }
    level = next;
  }
  return level[0]!;
}

/** The exact bytes covered by the attestation signature. */
export function signingPayload(manifest: ProjectManifest): string {
  const { attestation, ...rest } = manifest;
  void attestation;
  return canonicalJson({ ...rest, attestation: { ...manifest.attestation, signature: "" } });
}

export function generateAgentKeypair(): { publicKeyPem: string; privateKeyPem: string; keyId: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyId = sha256Hex(publicKeyPem).slice(0, 16);
  return { publicKeyPem, privateKeyPem, keyId };
}

export function signPayload(payload: string, privateKeyPem: string): string {
  // Ed25519 signs the message directly (PureEdDSA) — no pre-hash algorithm.
  return sign(null, Buffer.from(payload, "utf8"), createPrivateKey(privateKeyPem)).toString("hex");
}

export function verifyPayloadSignature(
  payload: string,
  signatureHex: string,
  publicKeyPem: string,
): boolean {
  try {
    if (!/^[0-9a-fA-F]+$/.test(signatureHex) || signatureHex.length % 2 !== 0) return false;
    return verify(
      null,
      Buffer.from(payload, "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

const CLAIM_CATEGORIES: ClaimCategory[] = [
  "core_functionality",
  "impact",
  "security",
  "privacy",
  "accessibility",
  "deployment",
  "performance",
];

const EVIDENCE_KINDS: EvidenceKind[] = [
  "ast_snapshot",
  "dependency_graph",
  "replay_capsule",
  "test_report",
  "runtime_trace",
  "interaction_recording",
  "interaction_trace",
  "spatial_demo_scene",
  "accessibility_report",
  "security_scan",
  "documentation_snapshot",
  "milestone_attestation",
];

/**
 * The six evidence modalities a judge can inspect (Evidence Lens table).
 * Each maps to the artifact kinds that satisfy it.
 */
export const MODALITIES = [
  {
    id: "ast",
    title: "AST constellation",
    captures: "Language-neutral AST graph, dependency edges, symbols, tests, migrations",
    judgeSees: "Architecture, ownership boundaries, dead code, risky dependency hubs",
    kinds: ["ast_snapshot", "dependency_graph"],
  },
  {
    id: "replay",
    title: "Replay capsule",
    captures: "Network-isolated executable environment plus seed and scenario contract",
    judgeSees: "Run this claim again instead of trusting a demo",
    kinds: ["replay_capsule", "runtime_trace"],
  },
  {
    id: "milestones",
    title: "Continuous state capture",
    captures: "Checkpoints at meaningful product milestones, hashed into a timeline",
    judgeSees: "The project's evolution without invasive keystroke surveillance",
    kinds: ["milestone_attestation"],
  },
  {
    id: "trace",
    title: "Interaction trace",
    captures: "Browser events, API spans, screenshots, accessibility tree, console events",
    judgeSees: "A replayable user journey with causal links to code and services",
    kinds: ["interaction_trace", "interaction_recording"],
  },
  {
    id: "scene",
    title: "Spatial demo scene",
    captures: "Annotated canvas: screen regions, data-flow anchors, narration cues, before/after states",
    judgeSees: "Enter the demo at any point, not scrub a video blindly",
    kinds: ["spatial_demo_scene"],
  },
  {
    id: "graph",
    title: "Claim-evidence graph",
    captures: "Every claimed feature maps to test runs, code regions, demo moments, documentation",
    judgeSees: "Unsupported claims and contradictory evidence become visible immediately",
    kinds: ["test_report", "documentation_snapshot", "security_scan", "accessibility_report"],
  },
] as const;

export type ModalityId = (typeof MODALITIES)[number]["id"];

const nonEmpty = (value: unknown) => typeof value === "string" && value.trim().length > 0;

/**
 * Structural validation of an inbound manifest. Returns human-readable
 * errors; empty means the manifest is well-formed (signature and Merkle
 * root are verified separately).
 */
export function validateManifest(manifest: unknown): string[] {
  const errors: string[] = [];
  if (typeof manifest !== "object" || manifest === null) return ["Manifest must be an object."];
  const m = manifest as Record<string, unknown>;

  if (m["schemaVersion"] !== "1.0") errors.push('schemaVersion must be "1.0".');
  for (const field of ["submissionId", "eventId", "projectId", "teamId", "merkleRoot"] as const) {
    if (!nonEmpty(m[field])) errors.push(`${field} is required.`);
  }
  if (typeof m["sealedAt"] !== "string" || !ISO_DATE.test(m["sealedAt"])) {
    errors.push("sealedAt must be an ISO-8601 timestamp.");
  }

  const attestation = m["attestation"] as Record<string, unknown> | undefined;
  if (typeof attestation !== "object" || attestation === null) {
    errors.push("attestation is required.");
  } else {
    if (attestation["algorithm"] !== "ed25519") errors.push('attestation.algorithm must be "ed25519".');
    if (!nonEmpty(attestation["publicKeyId"])) errors.push("attestation.publicKeyId is required.");
    if (!nonEmpty(attestation["signature"])) errors.push("attestation.signature is required.");
    if (!nonEmpty(attestation["agentVersion"])) errors.push("attestation.agentVersion is required.");
  }

  const claims = Array.isArray(m["claims"]) ? (m["claims"] as Record<string, unknown>[]) : null;
  if (!claims || claims.length === 0) {
    errors.push("At least one claim is required.");
  }
  const claimIds = new Set<string>();
  for (const [index, claim] of (claims ?? []).entries()) {
    if (!nonEmpty(claim["id"])) errors.push(`claims[${index}].id is required.`);
    else if (claimIds.has(claim["id"] as string)) errors.push(`Duplicate claim id "${claim["id"]}".`);
    else claimIds.add(claim["id"] as string);
    if (!nonEmpty(claim["statement"])) errors.push(`claims[${index}].statement is required.`);
    if (!CLAIM_CATEGORIES.includes(claim["category"] as ClaimCategory)) {
      errors.push(`claims[${index}].category is not a known category.`);
    }
    if (!Array.isArray(claim["expectedEvidence"])) errors.push(`claims[${index}].expectedEvidence must be an array.`);
    if (!Array.isArray(claim["evidenceRefs"])) errors.push(`claims[${index}].evidenceRefs must be an array.`);
  }

  const artifacts = Array.isArray(m["artifacts"]) ? (m["artifacts"] as Record<string, unknown>[]) : null;
  if (!artifacts) errors.push("artifacts must be an array.");
  const artifactIds = new Set<string>();
  for (const [index, artifact] of (artifacts ?? []).entries()) {
    if (!nonEmpty(artifact["id"])) errors.push(`artifacts[${index}].id is required.`);
    else if (artifactIds.has(artifact["id"] as string)) errors.push(`Duplicate artifact id "${artifact["id"]}".`);
    else artifactIds.add(artifact["id"] as string);
    if (!EVIDENCE_KINDS.includes(artifact["kind"] as EvidenceKind)) {
      errors.push(`artifacts[${index}].kind is not a known evidence kind.`);
    }
    if (!nonEmpty(artifact["contentHash"])) errors.push(`artifacts[${index}].contentHash is required.`);
    if (!nonEmpty(artifact["uri"])) errors.push(`artifacts[${index}].uri is required.`);
  }

  // Cross-references must resolve: no dangling evidence pointers.
  for (const claim of claims ?? []) {
    for (const ref of (claim["evidenceRefs"] as unknown[])) {
      if (typeof ref !== "string" || !artifactIds.has(ref)) {
        errors.push(`Claim "${claim["id"]}" references unknown artifact "${String(ref)}".`);
      }
    }
  }

  const environment = m["environment"] as Record<string, unknown> | undefined;
  if (typeof environment !== "object" || environment === null) {
    errors.push("environment is required.");
  } else {
    if (!["docker-compose", "container", "native"].includes(environment["runtime"] as string)) {
      errors.push("environment.runtime must be docker-compose, container, or native.");
    }
    if (!nonEmpty(environment["startupCommand"])) errors.push("environment.startupCommand is required.");
    if (!["offline", "allowlisted", "networked"].includes(environment["networkPolicy"] as string)) {
      errors.push("environment.networkPolicy must be offline, allowlisted, or networked.");
    }
    const scenarios = Array.isArray(environment["scenarios"])
      ? (environment["scenarios"] as Record<string, unknown>[])
      : null;
    if (!scenarios || scenarios.length === 0) {
      errors.push("environment.scenarios must declare at least one acceptance scenario.");
    } else {
      for (const [index, scenario] of scenarios.entries()) {
        if (!nonEmpty(scenario["id"])) errors.push(`scenarios[${index}].id is required.`);
        if (!Array.isArray(scenario["steps"]) || scenario["steps"].length === 0) {
          errors.push(`scenarios[${index}].steps must be a non-empty array.`);
        }
        for (const ref of ((scenario["claimRefs"] as unknown[]) ?? [])) {
          if (typeof ref !== "string" || !claimIds.has(ref)) {
            errors.push(`Scenario "${scenario["id"]}" references unknown claim "${String(ref)}".`);
          }
        }
      }
    }
  }

  if (!Array.isArray(m["policyDeclarations"])) errors.push("policyDeclarations must be an array.");

  return errors;
}

/** Recompute the Merkle root from the manifest's own artifacts. */
export function recomputeMerkleRoot(manifest: ProjectManifest): string {
  return merkleRoot(manifest.artifacts.map((a) => artifactLeafHash(a)));
}
