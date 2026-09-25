/**
 * Submit-form payload builder.
 *
 * The saveProject server schema speaks camelCase and requires eventId; the
 * form speaks snake_case and has no event id. This module is the single
 * translation point, unit-tested so a key drift can never again surface as a
 * raw zod error toast (see the eventId/teamName incident).
 */

export type SubmitFormState = {
  id?: string;
  title: string;
  teamName: string;
  tagline: string;
  description: string;
  repoUrl: string;
  demoUrl: string;
  videoUrl: string;
  thumbnailUrl: string;
  images: string;
  trackId: string;
  tags: string;
  answers: Record<string, string>;
};

export type SubmissionInput = {
  id: string | undefined;
  eventId: string;
  trackId: string | null;
  teamName: string;
  title: string;
  tagline: string;
  description: string;
  repoUrl: string;
  demoUrl: string;
  videoUrl: string;
  tags: string[];
  status: "draft" | "submitted";
};

/** The exact keys saveProject's submissionSchema accepts. */
export const SUBMISSION_INPUT_KEYS = [
  "id",
  "eventId",
  "trackId",
  "teamName",
  "title",
  "tagline",
  "description",
  "repoUrl",
  "demoUrl",
  "videoUrl",
  "tags",
  "status",
] as const;

/**
 * Optional URL fields accept "" (empty) or a valid URL — never null, which
 * the schema rejects.
 */
function urlOrEmpty(value: string): string {
  return value.trim();
}

export function buildSubmissionInput(
  form: SubmitFormState,
  eventId: string,
  status: "draft" | "submitted",
): SubmissionInput {  return {
    id: form.id,
    eventId,
    trackId: form.trackId || null,
    teamName: form.teamName,
    title: form.title,
    tagline: form.tagline,
    description: form.description,
    repoUrl: urlOrEmpty(form.repoUrl),
    demoUrl: urlOrEmpty(form.demoUrl),
    videoUrl: urlOrEmpty(form.videoUrl),
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    status,
  };
}

export type SubmissionWindow = {
  submissions_open: boolean;
  ends_at: string | null;
};

export type WindowStatus = {
  /** drafts may be saved/edited */
  savesAllowed: boolean;
  /** projects may be (re)submitted for judging */
  submitsAllowed: boolean;
  reason: string;
};

/**
 * Server-authoritative submission window. Drafts stay editable while the
 * event exists; submitting requires an open window and a future deadline.
 * Pure so both the UI (button states) and the server (enforcement) agree.
 */
export function submissionWindowStatus(
  event: SubmissionWindow | null | undefined,
  now: number = Date.now(),
): WindowStatus {
  if (!event) {
    return { savesAllowed: false, submitsAllowed: false, reason: "Event not loaded yet." };
  }
  if (!event.submissions_open) {
    return {
      savesAllowed: true,
      submitsAllowed: false,
      reason: "Submissions are closed — you can still edit drafts.",
    };
  }
  if (event.ends_at && Number.isFinite(new Date(event.ends_at).getTime())) {
    if (new Date(event.ends_at).getTime() <= now) {
      return {
        savesAllowed: true,
        submitsAllowed: false,
        reason: "The submission deadline has passed — you can still edit drafts.",
      };
    }
  }
  return { savesAllowed: true, submitsAllowed: true, reason: "" };
}
