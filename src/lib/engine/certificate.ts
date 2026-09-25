/**
 * Evidence certificate: the contestable decision receipt.
 *
 * All four ranking methods consume the same auditable score input (the
 * fixed-weight Q scores from scoring.ts). For a project's prize boundary the
 * certificate returns ROBUST when every rule agrees, otherwise FRAGILE with
 * the disagreement explained in plain language.
 */

import { RULE_LABELS, aggregateAll, type RuleId } from "./aggregate";
import type { Criterion, Review } from "./normalize";
import type { EvidenceReviewSignal } from "./evidence";

export type EligibilityStatus = "ELIGIBLE" | "PROVISIONAL" | "INELIGIBLE" | "MANUAL_REVIEW_REQUIRED";

export type MethodPlacement = {
  rank: number | null;
  score: number | null;
};

export type PrizeBoundaryVerdict = {
  boundary: string;
  verdict: "ROBUST" | "FRAGILE";
  agreeingMethods: string[];
  disagreeingMethods: string[];
  contenders: string[];
  explanation: string;
};

export type EvidenceCertificate = {
  projectId: string;
  scoreVersion: string;
  eligibilityStatus: EligibilityStatus;
  methods: Record<RuleId, MethodPlacement>;
  prizeBoundary: PrizeBoundaryVerdict;
  evidenceSummary: {
    sufficiency: number;
    signal: EvidenceReviewSignal;
    verifiedClaims: number;
    partialClaims: number;
    contradictedClaims: number;
  };
};

const RULE_IDS: RuleId[] = ["rawAverage", "calibrated", "bradleyTerry", "borda"];

export function buildEvidenceCertificate(params: {
  criteria: Criterion[];
  reviews: Review[];
  submissionIds: string[];
  projectId: string;
  /** how many top places decide prizes; the boundary is drawn below this */
  prizePositions?: number;
  minReviews?: number;
  eligibility: EligibilityStatus;
  evidence: {
    sufficiency: number;
    signal: EvidenceReviewSignal;
    verifiedClaims: number;
    partialClaims: number;
    contradictedClaims: number;
  };
}): EvidenceCertificate {
  const prizePositions = Math.max(1, params.prizePositions ?? 3);
  const rankings = aggregateAll({
    criteria: params.criteria,
    reviews: params.reviews,
    submissionIds: params.submissionIds,
  });
  const byRule = new Map(rankings.map((r) => [r.rule, r]));

  const methods = Object.fromEntries(
    RULE_IDS.map((rule) => {
      const ranking = byRule.get(rule);
      const rank = ranking?.ranks[params.projectId] ?? null;
      const score = ranking?.scores[params.projectId] ?? null;
      return [rule, { rank, score }];
    }),
  ) as Record<RuleId, MethodPlacement>;

  const ranks = RULE_IDS.map((rule) => methods[rule].rank);
  const distinct = new Set(ranks.filter((r): r is number => r !== null));
  const verdict: "ROBUST" | "FRAGILE" = distinct.size <= 1 ? "ROBUST" : "FRAGILE";

  // Everything any rule places within one rank of this project's best or
  // worst placement is still in contention for the boundary.
  const numeric = [...distinct];
  const lo = numeric.length ? Math.min(...numeric) - 1 : 1;
  const hi = numeric.length ? Math.max(...numeric) + 1 : prizePositions + 1;
  const contenders = new Set<string>();
  for (const ranking of rankings) {
    ranking.order.forEach((id, index) => {
      const rank = index + 1;
      if (rank >= lo && rank <= hi && id !== params.projectId) contenders.add(id);
    });
  }

  const boundary = `Top-${prizePositions} prize cutoff`;
  const agreeingMethods = RULE_IDS.filter((rule) => {
    const first = RULE_IDS[0]!;
    return methods[rule].rank === methods[first].rank;
  }).map((rule) => RULE_LABELS[rule]);
  const disagreeingMethods = RULE_IDS.filter(
    (rule) => !agreeingMethods.includes(RULE_LABELS[rule]),
  ).map((rule) => RULE_LABELS[rule]);

  const explanation =
    verdict === "ROBUST"
      ? `This prize boundary is ROBUST. Raw average, judge-calibrated average, pairwise Bradley-Terry, and rank-based Borda all place this project at rank ${numeric[0] ?? "unranked"}.`
      : `This prize boundary is FRAGILE. ${agreeingMethods.join(" and ") || "No method"} place${agreeingMethods.length === 1 ? "s" : ""} this project at rank ${methods[RULE_IDS[0]!]!.rank ?? "unranked"}, but ${disagreeingMethods.join(" and ")} disagree. The main uncertainty is low reviewer agreement near the ${boundary.toLowerCase()}; contenders still in range: ${[...contenders].join(", ") || "none"}.`;

  return {
    projectId: params.projectId,
    scoreVersion: "rubric-v1",
    eligibilityStatus: params.eligibility,
    methods,
    prizeBoundary: {
      boundary,
      verdict,
      agreeingMethods,
      disagreeingMethods,
      contenders: [...contenders].sort(),
      explanation,
    },
    evidenceSummary: {
      sufficiency: Math.round(params.evidence.sufficiency * 1000) / 1000,
      signal: params.evidence.signal,
      verifiedClaims: params.evidence.verifiedClaims,
      partialClaims: params.evidence.partialClaims,
      contradictedClaims: params.evidence.contradictedClaims,
    },
  };
}
