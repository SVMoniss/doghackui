/**
 * Evidence engine: how much proof a project needs, and what its
 * claim-evidence graph currently shows.
 *
 * Complexity changes the evidence bar, never the score. Every function here
 * is pure and deterministic so findings stay contestable and auditable.
 */

export type EvidenceReviewSignal = "SUFFICIENT" | "REQUESTED_EVIDENCE" | "MANUAL_REVIEW_REQUIRED";

export type ClaimStatus = "SUPPORTED" | "PARTIAL" | "UNVERIFIED" | "CONTRADICTED";

export type LinkRelationship = "SUPPORTS" | "PARTIALLY_SUPPORTS" | "CONTRADICTS" | "CONTEXT";

export type ClaimEvidenceLink = {
  claimId: string;
  evidenceId: string;
  relationship: LinkRelationship;
  /** 0..1 — confidence in the evidence link, never project quality. */
  confidence: number;
  explanation: string;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Evidence Sufficiency Index: ESI = 0.35T + 0.30R + 0.20D + 0.15S.
 * Inputs are 0..1 component scores (clamped defensively).
 */
export function evidenceSufficiencyIndex(parts: {
  /** test evidence quality */
  test: number;
  /** replay scenario success */
  replay: number;
  /** documentation and claim traceability */
  docs: number;
  /** security, privacy and operational evidence */
  security: number;
}): number {
  const t = clamp01(parts.test);
  const r = clamp01(parts.replay);
  const d = clamp01(parts.docs);
  const s = clamp01(parts.security);
  return 0.35 * t + 0.3 * r + 0.2 * d + 0.15 * s;
}

/**
 * Evidence target: Target = 0.35 + 0.35C + 0.15A + 0.15H.
 * A bigger, more connected, or more sensitive system owes more proof.
 */
export function evidenceTarget(parts: {
  /** normalized system complexity */
  complexity: number;
  /** API/service surface area */
  apiSurface: number;
  /** harm or sensitivity risk */
  harm: number;
}): number {
  return (
    0.35 + 0.35 * clamp01(parts.complexity) + 0.15 * clamp01(parts.apiSurface) + 0.15 * clamp01(parts.harm)
  );
}

/**
 * Visible review signal. This is shown to teams and judges and must never
 * silently modify a project's score.
 */
export function evidenceSignal(sufficiency: number, target: number): EvidenceReviewSignal {
  if (sufficiency >= target) return "SUFFICIENT";
  if (sufficiency >= target - 0.15) return "REQUESTED_EVIDENCE";
  return "MANUAL_REVIEW_REQUIRED";
}

/**
 * Derive a claim's status from its evidence links. Any contradiction wins;
 * support without contradiction confirms; partial support stays partial;
 * no links means unverified — never assumed true.
 */
export function deriveClaimStatus(links: Pick<ClaimEvidenceLink, "relationship">[]): ClaimStatus {
  if (links.length === 0) return "UNVERIFIED";
  if (links.some((l) => l.relationship === "CONTRADICTS")) return "CONTRADICTED";
  const supporting = links.filter(
    (l) => l.relationship === "SUPPORTS" || l.relationship === "PARTIALLY_SUPPORTS",
  );
  if (supporting.length === 0) return "UNVERIFIED";
  if (supporting.every((l) => l.relationship === "SUPPORTS")) return "SUPPORTED";
  return "PARTIAL";
}

export type AnomalySeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AnomalyCategory = "replay" | "security" | "accessibility" | "claim" | "configuration";
export type AnomalyAction = "EXPLAIN" | "ATTACH_EVIDENCE" | "WAIVE" | "RETRY";

export type Anomaly = {
  id: string;
  severity: AnomalySeverity;
  category: AnomalyCategory;
  finding: string;
  confidence: number;
  evidenceRefs: string[];
  allowedActions: AnomalyAction[];
};

export type AnomalyInput = {
  claims: { id: string; status: ClaimStatus; category: string }[];
  links: ClaimEvidenceLink[];
  artifactKinds: string[];
  replaySucceeded: boolean;
  replayExists: boolean;
  hasSecurityEvidence: boolean;
  hasAccessibilityEvidence: boolean;
};

/**
 * Deterministic, rule-based anomaly classifier. Every finding names its
 * evidence and offers explicit actions — nothing is a vague red error, and
 * nothing deducts score on its own.
 */
export function classifyAnomalies(input: AnomalyInput): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const claim of input.claims) {
    if (claim.status === "CONTRADICTED") {
      const refs = input.links.filter((l) => l.claimId === claim.id).map((l) => l.evidenceId);
      anomalies.push({
        id: `claim-contradicted-${claim.id}`,
        severity: "HIGH",
        category: "claim",
        finding: `Claim "${claim.id}" is contradicted by stored evidence. A judge must acknowledge this before submitting an assessment.`,
        confidence: 0.95,
        evidenceRefs: refs,
        allowedActions: ["EXPLAIN", "ATTACH_EVIDENCE", "WAIVE"],
      });
    } else if (claim.status === "UNVERIFIED") {
      anomalies.push({
        id: `claim-unverified-${claim.id}`,
        severity: "LOW",
        category: "claim",
        finding: `Claim "${claim.id}" has no supporting evidence yet.`,
        confidence: 0.9,
        evidenceRefs: [],
        allowedActions: ["ATTACH_EVIDENCE", "EXPLAIN"],
      });
    }
  }

  if (!input.replayExists) {
    anomalies.push({
      id: "replay-missing",
      severity: "MEDIUM",
      category: "replay",
      finding: "No replay capsule run is recorded. Technical Execution cannot be verified by replay.",
      confidence: 0.9,
      evidenceRefs: [],
      allowedActions: ["ATTACH_EVIDENCE", "RETRY"],
    });
  } else if (!input.replaySucceeded) {
    anomalies.push({
      id: "replay-failed",
      severity: "CRITICAL",
      category: "replay",
      finding:
        "The core project flow failed in a valid replay environment. Technical Execution cannot exceed 4/10 unless the issue is proven environmental.",
      confidence: 0.92,
      evidenceRefs: [],
      allowedActions: ["EXPLAIN", "RETRY", "WAIVE"],
    });
  }

  if (!input.hasSecurityEvidence) {
    anomalies.push({
      id: "security-missing",
      severity: "MEDIUM",
      category: "security",
      finding: "No security or privacy evidence is attached. Sensitive claims stay unverified.",
      confidence: 0.85,
      evidenceRefs: [],
      allowedActions: ["ATTACH_EVIDENCE", "EXPLAIN"],
    });
  }

  if (!input.hasAccessibilityEvidence) {
    anomalies.push({
      id: "accessibility-missing",
      severity: "INFO",
      category: "accessibility",
      finding: "No accessibility evidence is attached. Judges must still answer the Design accessibility prompts.",
      confidence: 0.8,
      evidenceRefs: [],
      allowedActions: ["ATTACH_EVIDENCE", "EXPLAIN"],
    });
  }

  return anomalies;
}

export type StressScenario = {
  id: string;
  title: string;
  /** alternate weights used only to probe sensitivity — never to score */
  weights: Record<string, number>;
  focus: string;
};

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: "balanced",
    title: "Balanced rubric",
    weights: { impact: 0.2, innovation: 0.2, technical_execution: 0.2, design: 0.2, presentation_evidence: 0.2 },
    focus: "Every criterion counts equally.",
  },
  {
    id: "execution-first",
    title: "Execution-first",
    weights: { impact: 0.1, innovation: 0.1, technical_execution: 0.6, design: 0.1, presentation_evidence: 0.1 },
    focus: "Reliability and reproducibility dominate.",
  },
  {
    id: "impact-first",
    title: "Impact-first",
    weights: { impact: 0.5, innovation: 0.15, technical_execution: 0.15, design: 0.1, presentation_evidence: 0.1 },
    focus: "Real-world benefit dominates.",
  },
  {
    id: "evidence-strict",
    title: "Evidence-strict",
    weights: { impact: 0.15, innovation: 0.1, technical_execution: 0.3, design: 0.1, presentation_evidence: 0.35 },
    focus: "Verifiability and presentation dominate.",
  },
];

const scoreUnder = (
  normalized: Record<string, number>,
  weights: Record<string, number>,
): number => {
  const total = Object.entries(weights).reduce(
    (sum, [criterion, weight]) => sum + (normalized[criterion] ?? 0) * weight,
    0,
  );
  return 1 + 9 * total;
};

/**
 * Sensitivity probe: recompute the project's own score under each stress
 * scenario and describe the delta in plain language. Shows only the
 * project's own sensitivity — never placement or competitor data.
 */
export function stressSensitivities(params: {
  normalized: Record<string, number>;
  baseWeights: Record<string, number>;
}): { scenarioId: string; title: string; delta: number; message: string }[] {
  const base = scoreUnder(params.normalized, params.baseWeights);
  return STRESS_SCENARIOS.map((scenario) => {
    const probed = scoreUnder(params.normalized, scenario.weights);
    const delta = probed - base;
    const direction =
      delta >= 0.25
        ? "becomes stronger"
        : delta <= -0.25
          ? "becomes lower"
          : "barely moves";
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      delta: Math.round(delta * 100) / 100,
      message: `Your score confidence ${direction} under ${scenario.title} (${scenario.focus} ${delta >= 0 ? "+" : ""}${(Math.round(delta * 100) / 100).toFixed(2)} points).`,
    };
  });
}
