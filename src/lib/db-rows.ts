/**
 * Explicit Postgres row mappings. pg returns numerics as strings and
 * timestamps as Dates, so every boundary normalizes to the stable shapes
 * the UI already expects (numbers, ISO strings, string arrays).
 */

export function isoDate(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : (value as string);
}

export type EventRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  submissions_open: boolean;
  judging_open: boolean;
  reviews_per_submission: number;
  created_at: string | null;
  updated_at: string | null;
};

export function mapEventRow(r: Record<string, unknown>): EventRow {
  return {
    id: r["id"] as string,
    slug: r["slug"] as string,
    name: r["name"] as string,
    tagline: (r["tagline"] as string | null) ?? null,
    description: (r["description"] as string | null) ?? null,
    starts_at: isoDate(r["starts_at"]),
    ends_at: isoDate(r["ends_at"]),
    submissions_open: Boolean(r["submissions_open"]),
    judging_open: Boolean(r["judging_open"]),
    reviews_per_submission: Number(r["reviews_per_submission"]),
    created_at: isoDate(r["created_at"]),
    updated_at: isoDate(r["updated_at"]),
  };
}

export type SubmissionRow = {
  id: string;
  event_id: string;
  track_id: string | null;
  owner_id: string | null;
  team_name: string;
  title: string;
  tagline: string | null;
  description: string | null;
  repo_url: string | null;
  demo_url: string | null;
  video_url: string | null;
  tags: string[];
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export function mapSubmissionRow(r: Record<string, unknown>): SubmissionRow {
  return {
    id: r["id"] as string,
    event_id: r["event_id"] as string,
    track_id: (r["track_id"] as string | null) ?? null,
    owner_id: (r["owner_id"] as string | null) ?? null,
    team_name: r["team_name"] as string,
    title: r["title"] as string,
    tagline: (r["tagline"] as string | null) ?? null,
    description: (r["description"] as string | null) ?? null,
    repo_url: (r["repo_url"] as string | null) ?? null,
    demo_url: (r["demo_url"] as string | null) ?? null,
    video_url: (r["video_url"] as string | null) ?? null,
    tags: ((r["tags"] as string[]) ?? []) as string[],
    status: r["status"] as string,
    created_at: isoDate(r["created_at"]),
    updated_at: isoDate(r["updated_at"]),
  };
}
