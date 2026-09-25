import { describe, expect, it } from "vitest";

import {
  artifactLeafHash,
  canonicalJson,
  generateAgentKeypair,
  merkleRoot,
  MODALITIES,
  recomputeMerkleRoot,
  sha256Hex,
  signPayload,
  signingPayload,
  validateManifest,
  verifyPayloadSignature,
  type ProjectManifest,
} from "./manifest";

const baseManifest = (): ProjectManifest => ({
  schemaVersion: "1.0",
  submissionId: "11111111-1111-1111-1111-111111111111",
  eventId: "22222222-2222-2222-2222-222222222222",
  projectId: "mesh-demo",
  teamId: "team-1",
  sealedAt: "2026-09-20T12:00:00Z",
  merkleRoot: "",
  attestation: { algorithm: "ed25519", publicKeyId: "k1", signature: "pending-signature", agentVersion: "mesh/0.1.0" },
  claims: [
    {
      id: "offline_operation",
      statement: "The platform runs without external network access.",
      category: "deployment",
      expectedEvidence: ["replay_capsule"],
      evidenceRefs: ["replay_offline_002"],
      status: "UNVERIFIED",
    },
  ],
  artifacts: [
    {
      id: "replay_offline_002",
      kind: "replay_capsule",
      contentHash: sha256Hex("capsule"),
      uri: "mesh://capsule/002",
      createdAt: "2026-09-20T12:00:00Z",
      provenance: { producer: "mesh-agent", trusted: true },
    },
  ],
  environment: {
    runtime: "docker-compose",
    startupCommand: "docker compose up",
    healthChecks: [{ id: "h1", kind: "health", target: "http://localhost:3000", expectation: "HTTP 200" }],
    scenarios: [
      {
        id: "s1",
        title: "Participant workflow",
        steps: [{ id: "st1", kind: "http", target: "http://localhost:3000", expectation: "HTTP 200" }],
        expectedOutcome: "Workflow completes offline.",
        claimRefs: ["offline_operation"],
      },
    ],
    networkPolicy: "offline",
  },
  policyDeclarations: [{ type: "no_secrets_uploaded", statement: "No secrets were uploaded." }],
});

describe("canonicalJson", () => {
  it("orders keys deterministically regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  });
});

describe("merkleRoot", () => {
  it("is order-independent and detects tampering", () => {
    const leaves = ["aaa", "bbb", "ccc"];
    const root = merkleRoot(leaves);
    expect(merkleRoot(["ccc", "aaa", "bbb"])).toBe(root);
    expect(merkleRoot(["aaa", "bbb", "ccd"])).not.toBe(root);
  });

  it("hashes the empty set to a fixed domain tag", () => {
    expect(merkleRoot([])).toBe(sha256Hex("openjudge:empty-manifest"));
  });
});

describe("signing round-trip", () => {
  it("signs and verifies, and rejects tampered payloads", () => {
    const { publicKeyPem, privateKeyPem } = generateAgentKeypair();
    const manifest = baseManifest();
    manifest.merkleRoot = recomputeMerkleRoot(manifest);
    const payload = signingPayload(manifest);

    const signature = signPayload(payload, privateKeyPem);
    expect(verifyPayloadSignature(payload, signature, publicKeyPem)).toBe(true);
    expect(verifyPayloadSignature(`${payload}tampered`, signature, publicKeyPem)).toBe(false);
    expect(verifyPayloadSignature(payload, signature, generateAgentKeypair().publicKeyPem)).toBe(false);
  });
});

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const manifest = baseManifest();
    manifest.merkleRoot = recomputeMerkleRoot(manifest);
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("rejects dangling evidence refs, unknown scenarios claims, and bad enums", () => {
    const manifest = baseManifest();
    manifest.claims[0]!.evidenceRefs = ["missing-artifact"];
    manifest.environment.scenarios[0]!.claimRefs = ["missing-claim"];
    manifest.environment.networkPolicy = "sometimes" as never;
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.includes("missing-artifact"))).toBe(true);
    expect(errors.some((e) => e.includes("missing-claim"))).toBe(true);
    expect(errors.some((e) => e.includes("networkPolicy"))).toBe(true);
  });

  it("requires at least one claim and one scenario", () => {
    const manifest = baseManifest();
    manifest.claims = [];
    manifest.environment.scenarios = [];
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.includes("claim"))).toBe(true);
    expect(errors.some((e) => e.includes("scenario"))).toBe(true);
  });
});

describe("artifactLeafHash", () => {
  it("binds kind, id, and content hash together", () => {
    const a = { id: "x", kind: "test_report" as const, contentHash: "h" };
    expect(artifactLeafHash(a)).not.toBe(artifactLeafHash({ ...a, contentHash: "other" }));
    expect(artifactLeafHash(a)).not.toBe(artifactLeafHash({ ...a, id: "y" }));
  });
});

describe("evidence modalities", () => {
  it("declares the six judge-inspectable modalities", () => {
    expect(MODALITIES.map((m) => m.id)).toEqual(["ast", "replay", "milestones", "trace", "scene", "graph"]);
    for (const modality of MODALITIES) {
      expect(modality.title.length).toBeGreaterThan(0);
      expect(modality.judgeSees.length).toBeGreaterThan(0);
      expect(modality.kinds.length).toBeGreaterThan(0);
    }
  });

  it("accepts interaction_trace and spatial_demo_scene artifacts", () => {
    const manifest = baseManifest();
    manifest.artifacts.push(
      {
        id: "trace_001",
        kind: "interaction_trace",
        contentHash: sha256Hex("trace"),
        uri: "mesh-agent:interaction_trace/abc",
        createdAt: "2026-09-20T12:00:00Z",
        provenance: { producer: "participant", trusted: false },
      },
      {
        id: "scene_001",
        kind: "spatial_demo_scene",
        contentHash: sha256Hex("scene"),
        uri: "mesh-agent:spatial_demo_scene/def",
        createdAt: "2026-09-20T12:00:00Z",
        provenance: { producer: "participant", trusted: false },
      },
    );
    manifest.merkleRoot = recomputeMerkleRoot(manifest);
    expect(validateManifest(manifest)).toEqual([]);
  });
});
