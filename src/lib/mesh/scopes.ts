import { meshPool } from "./db";

/**
 * Track scopes for judges (self-host Postgres). Returns judgeId -> trackId
 * for scoped judges; a missing key means "all tracks". Never throws — the
 * judging flows treat a missing store as "no scopes configured".
 */
export async function loadJudgeScopes(judgeIds: string[]): Promise<Record<string, string | null>> {
  if (judgeIds.length === 0) return {};
  try {
    const { rows } = await meshPool().query(
      "select judge_id, track_id from public.judge_scopes where judge_id = any ($1)",
      [judgeIds],
    );
    return Object.fromEntries(
      (rows as { judge_id: string; track_id: string | null }[]).map((r) => [r.judge_id, r.track_id]),
    );
  } catch {
    return {};
  }
}
