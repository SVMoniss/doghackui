import { describe, expect, it } from "vitest";

import {
  SUBMISSION_INPUT_KEYS,
  buildSubmissionInput,
  submissionWindowStatus,
  type SubmitFormState,
} from "./submit-payload";

const form = (overrides: Partial<SubmitFormState> = {}): SubmitFormState => ({
  title: "LogLens",
  teamName: "Null Pointers",
  tagline: "Readable stack traces",
  description: "Parses logs.",
  repoUrl: "https://example.org/loglens",
  demoUrl: "",
  videoUrl: "   ",
  thumbnailUrl: "",
  images: "",
  trackId: "",
  tags: "logging, devtools ,",
  answers: {},
  ...overrides,
});

describe("buildSubmissionInput", () => {
  it("emits exactly the keys the saveProject schema accepts, including eventId", () => {
    const input = buildSubmissionInput(form(), "event-123", "draft");
    expect(new Set(Object.keys(input))).toEqual(new Set(SUBMISSION_INPUT_KEYS));
    expect(input.eventId).toBe("event-123");
    expect(input.teamName).toBe("Null Pointers");
    expect(input.title).toBe("LogLens");
  });

  it("never sends snake_case keys or null URLs", () => {
    const input = buildSubmissionInput(form(), "event-123", "submitted");
    const keys = Object.keys(input);
    expect(keys).not.toContain("team_name");
    expect(keys).not.toContain("repo_url");
    expect(keys).not.toContain("track_id");
    expect(input.demoUrl).toBe("");
    expect(input.videoUrl).toBe("");
    expect(input.repoUrl).toBe("https://example.org/loglens");
  });

  it("maps empty track to null and splits tags", () => {
    const input = buildSubmissionInput(form({ trackId: "track-1" }), "event-123", "draft");
    expect(input.trackId).toBe("track-1");
    expect(buildSubmissionInput(form(), "event-123", "draft").trackId).toBeNull();
    expect(input.tags).toEqual(["logging", "devtools"]);
  });

  it("passes the status and form id through", () => {
    const draft = buildSubmissionInput(form(), "e", "draft");
    const submitted = buildSubmissionInput(form({ id: "proj-1" }), "e", "submitted");
    expect(draft.status).toBe("draft");
    expect(draft.id).toBeUndefined();
    expect(submitted.status).toBe("submitted");
    expect(submitted.id).toBe("proj-1");
  });
});

describe("submissionWindowStatus", () => {
  const NOW = new Date("2026-09-20T12:00:00Z").getTime();

  it("blocks everything when the event is missing", () => {
    const status = submissionWindowStatus(null, NOW);
    expect(status.savesAllowed).toBe(false);
    expect(status.submitsAllowed).toBe(false);
  });

  it("allows drafts but not submits when closed or past deadline", () => {
    const closed = submissionWindowStatus({ submissions_open: false, ends_at: null }, NOW);
    expect(closed.savesAllowed).toBe(true);
    expect(closed.submitsAllowed).toBe(false);
    expect(closed.reason).toMatch(/closed/i);

    const past = submissionWindowStatus(
      { submissions_open: true, ends_at: "2026-09-19T12:00:00Z" },
      NOW,
    );
    expect(past.savesAllowed).toBe(true);
    expect(past.submitsAllowed).toBe(false);
    expect(past.reason).toMatch(/deadline/i);
  });

  it("allows both when open with a future deadline", () => {
    const status = submissionWindowStatus(
      { submissions_open: true, ends_at: "2026-10-04T17:00:00Z" },
      NOW,
    );
    expect(status.savesAllowed).toBe(true);
    expect(status.submitsAllowed).toBe(true);
  });

  it("treats an unparseable deadline as no deadline", () => {
    const status = submissionWindowStatus({ submissions_open: true, ends_at: "soon" }, NOW);
    expect(status.submitsAllowed).toBe(true);
  });
});
