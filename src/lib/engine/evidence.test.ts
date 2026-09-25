import { describe, expect, it } from "vitest";

import {
  classifyAnomalies,
  deriveClaimStatus,
  evidenceSignal,
  evidenceSufficiencyIndex,
  evidenceTarget,
  stressSensitivities,
} from "./evidence";

describe("evidenceSufficiencyIndex", () => {
  it("computes 0.35T + 0.30R + 0.20D + 0.15S", () => {
    expect(evidenceSufficiencyIndex({ test: 1, replay: 1, docs: 1, security: 1 })).toBeCloseTo(1, 10);
    expect(evidenceSufficiencyIndex({ test: 0, replay: 0, docs: 0, security: 0 })).toBe(0);
    expect(evidenceSufficiencyIndex({ test: 1, replay: 0, docs: 0, security: 0 })).toBeCloseTo(
      0.35,
      10,
    );
  });

  it("clamps out-of-range components into 0..1", () => {
    expect(evidenceSufficiencyIndex({ test: 5, replay: -2, docs: 1, security: 1 })).toBeCloseTo(
      0.35 * 1 + 0.3 * 0 + 0.2 * 1 + 0.15 * 1,
      10,
    );
  });
});

describe("evidenceTarget", () => {
  it("computes 0.35 + 0.35C + 0.15A + 0.15H", () => {
    expect(evidenceTarget({ complexity: 0, apiSurface: 0, harm: 0 })).toBeCloseTo(0.35, 10);
    expect(evidenceTarget({ complexity: 1, apiSurface: 1, harm: 1 })).toBeCloseTo(1, 10);
  });
});

describe("evidenceSignal", () => {
  it("returns SUFFICIENT at or above target", () => {
    expect(evidenceSignal(0.8, 0.8)).toBe("SUFFICIENT");
    expect(evidenceSignal(0.9, 0.8)).toBe("SUFFICIENT");
  });

  it("returns REQUESTED_EVIDENCE within 0.15 below target", () => {
    expect(evidenceSignal(0.7, 0.8)).toBe("REQUESTED_EVIDENCE");
  });

  it("returns MANUAL_REVIEW_REQUIRED further below target", () => {
    expect(evidenceSignal(0.5, 0.8)).toBe("MANUAL_REVIEW_REQUIRED");
  });
});

describe("deriveClaimStatus", () => {
  it("is UNVERIFIED with no links", () => {
    expect(deriveClaimStatus([])).toBe("UNVERIFIED");
  });

  it("contradiction always wins", () => {
    expect(
      deriveClaimStatus([{ relationship: "SUPPORTS" }, { relationship: "CONTRADICTS" }]),
    ).toBe("CONTRADICTED");
  });

  it("full support confirms, partial support stays partial", () => {
    expect(deriveClaimStatus([{ relationship: "SUPPORTS" }])).toBe("SUPPORTED");
    expect(deriveClaimStatus([{ relationship: "PARTIALLY_SUPPORTS" }])).toBe("PARTIAL");
    expect(
      deriveClaimStatus([{ relationship: "SUPPORTS" }, { relationship: "PARTIALLY_SUPPORTS" }]),
    ).toBe("PARTIAL");
  });

  it("context-only links leave a claim unverified", () => {
    expect(deriveClaimStatus([{ relationship: "CONTEXT" }])).toBe("UNVERIFIED");
  });
});

describe("classifyAnomalies", () => {
  it("flags contradicted claims HIGH and unverified claims LOW", () => {
    const anomalies = classifyAnomalies({
      claims: [
        { id: "a", status: "CONTRADICTED", category: "deployment" },
        { id: "b", status: "UNVERIFIED", category: "impact" },
      ],
      links: [{ claimId: "a", evidenceId: "e1", relationship: "CONTRADICTS", confidence: 0.9, explanation: "x" }],
      artifactKinds: [],
      replaySucceeded: true,
      replayExists: true,
      hasSecurityEvidence: true,
      hasAccessibilityEvidence: true,
    });
    const contradicted = anomalies.find((a) => a.id === "claim-contradicted-a");
    expect(contradicted?.severity).toBe("HIGH");
    expect(contradicted?.allowedActions).toContain("WAIVE");
    expect(anomalies.find((a) => a.id === "claim-unverified-b")?.severity).toBe("LOW");
  });

  it("treats a failed replay as CRITICAL with the 4/10 execution cap message", () => {
    const anomalies = classifyAnomalies({
      claims: [],
      links: [],
      artifactKinds: [],
      replaySucceeded: false,
      replayExists: true,
      hasSecurityEvidence: true,
      hasAccessibilityEvidence: true,
    });
    const failed = anomalies.find((a) => a.id === "replay-failed");
    expect(failed?.severity).toBe("CRITICAL");
    expect(failed?.finding).toContain("4/10");
  });

  it("every anomaly names evidence refs and offers explicit actions", () => {
    const anomalies = classifyAnomalies({
      claims: [],
      links: [],
      artifactKinds: [],
      replaySucceeded: false,
      replayExists: false,
      hasSecurityEvidence: false,
      hasAccessibilityEvidence: false,
    });
    expect(anomalies.length).toBeGreaterThan(0);
    for (const anomaly of anomalies) {
      expect(Array.isArray(anomaly.evidenceRefs)).toBe(true);
      expect(anomaly.allowedActions.length).toBeGreaterThan(0);
    }
  });
});

describe("stressSensitivities", () => {
  it("describes the project's own sensitivity without competitor data", () => {
    const out = stressSensitivities({
      normalized: {
        impact: 0.9,
        innovation: 0.9,
        technical_execution: 0.2,
        design: 0.5,
        presentation_evidence: 0.5,
      },
      baseWeights: {
        impact: 0.25,
        innovation: 0.2,
        technical_execution: 0.3,
        design: 0.15,
        presentation_evidence: 0.1,
      },
    });
    expect(out).toHaveLength(4);
    const executionFirst = out.find((s) => s.scenarioId === "execution-first")!;
    // weak execution should read as lower confidence under execution-first
    expect(executionFirst.delta).toBeLessThan(-0.25);
    expect(executionFirst.message).toContain("becomes lower");
    for (const row of out) {
      expect(row.message).not.toMatch(/rank|place|competitor|opponent/i);
    }
  });
});
