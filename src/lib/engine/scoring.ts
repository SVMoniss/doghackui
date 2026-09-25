/**
 * Fixed-weight scoring engine for the evidence-first evaluation pipeline.
 *
 * Fairness rule: score weights are fixed at the event level and declared
 * before submissions open. They never change per project — complexity only
 * raises the evidence bar (see evidence.ts), never the weights.
 */

import type { Criterion, Review } from "./normalize";

export const RUBRIC_VERSION = "rubric-v1" as const;

export type CriterionId =
  | "impact"
  | "innovation"
  | "technical_execution"
  | "design"
  | "presentation_evidence";

export const CRITERION_IDS: CriterionId[] = [
  "impact",
  "innovation",
  "technical_execution",
  "design",
  "presentation_evidence",
];

export const WEIGHTS: Record<CriterionId, number> = {
  impact: 0.25,
  innovation: 0.2,
  technical_execution: 0.3,
  design: 0.15,
  presentation_evidence: 0.1,
} as const;

export const CRITERION_META: Record<
  CriterionId,
  { label: string; question: string; position: number }
> = {
  impact: {
    label: "Impact",
    question: "Does the project address a meaningful problem with a plausible, measurable benefit?",
    position: 1,
  },
  innovation: {
    label: "Innovation",
    question: "Does it offer a meaningfully differentiated mechanism, insight, or synthesis?",
    position: 2,
  },
  technical_execution: {
    label: "Technical Execution",
    question: "Does the system work reliably, reproducibly, and safely?",
    position: 3,
  },
  design: {
    label: "Design",
    question: "Is it clear, usable, accessible, and resilient?",
    position: 4,
  },
  presentation_evidence: {
    label: "Presentation & Evidence",
    question: "Can judges understand and verify the project's claims and stated limitations?",
    position: 5,
  },
};

/** Map a 1–10 integer score onto 0–1. */
export function normalizedScore(rawScore: number): number {
  return (rawScore - 1) / 9;
}

/**
 * The single project score Q(j,p) every ranking rule consumes:
 * fixed-weight sum of normalized criterion scores, mapped back to 1–10.
 */
export function calculateJudgeProjectScore(assessments: Record<CriterionId, number>): number {
  const weighted = (Object.entries(WEIGHTS) as [CriterionId, number][]).reduce(
    (total, [criterion, weight]) => total + normalizedScore(assessments[criterion]) * weight,
    0,
  );
  return 1 + 9 * weighted;
}

export type AssessmentInput = {
  criterion: string;
  score: number;
  confidence: number;
  rationale: string;
  evidenceRefs: string[];
  acknowledgedFlags: string[];
};

const isInt = (n: number) => Number.isInteger(n);

/** Human-readable validation errors; empty means the assessment is acceptable. */
export function validateAssessment(input: AssessmentInput): string[] {
  const errors: string[] = [];
  if (!(input.criterion in WEIGHTS)) {
    errors.push(`Unknown criterion "${input.criterion}".`);
  }
  if (!isInt(input.score) || input.score < 1 || input.score > 10) {
    errors.push("Score must be an integer from 1 to 10.");
  }
  if (!isInt(input.confidence) || input.confidence < 1 || input.confidence > 5) {
    errors.push("Confidence must be an integer from 1 to 5.");
  }
  if (!input.rationale || input.rationale.trim().length < 10) {
    errors.push("Rationale is required (at least 10 characters).");
  }
  if (input.rationale && input.rationale.length > 2000) {
    errors.push("Rationale must be 2000 characters or fewer.");
  }
  return errors;
}

/** Criterion rows shaped for the shared aggregation pipeline (normalize/aggregate). */
export function rubricCriteria(): Criterion[] {
  return CRITERION_IDS.map((id) => ({
    id,
    name: CRITERION_META[id]!.label,
    weight: WEIGHTS[id]!,
    minScore: 1,
    maxScore: 10,
  }));
}

export type JudgeAssessmentSet = {
  judgeKey: string;
  submissionId: string;
  scores: Record<CriterionId, number>;
};

/**
 * Convert human assessments into Review rows. The score stored per criterion
 * is the raw 1–10 integer; weightedTotal over rubricCriteria() then equals
 * calculateJudgeProjectScore exactly, so all four ranking rules consume the
 * same auditable input as the published formula.
 */
export function assessmentsToReviews(sets: JudgeAssessmentSet[]): Review[] {
  return sets.map((set) => ({
    judgeId: set.judgeKey,
    submissionId: set.submissionId,
    scores: Object.fromEntries(
      CRITERION_IDS.map((id) => [id, set.scores[id]]),
    ) as Record<string, number>,
  }));
}
