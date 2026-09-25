/**
 * OpenAPI 3.0 for the OpenJudge REST API. Documents exactly the routes
 * implemented in rest.ts — no more, no less (honest spec beat inflated spec).
 */

export const OPENAPI = {
  openapi: "3.0.3",
  info: {
    title: "OpenJudge API",
    version: "1.0.0",
    description:
      "Self-hosted hackathon submissions and judging. Auth is a session cookie (POST /api/auth/signin); organizer routes need the organizer or admin role. Webhooks fire on submission.submitted, review.submitted, voting.published, and eligibility.decided.",
  },
  servers: [{ url: "/", description: "Self-hosted instance" }],
  security: [{ cookieAuth: [] }],
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "oj_session" },
    },
    schemas: {
      Event: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          name: { type: "string" },
          tagline: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          starts_at: { type: "string", nullable: true },
          ends_at: { type: "string", nullable: true },
          submissions_open: { type: "boolean" },
          judging_open: { type: "boolean" },
          reviews_per_submission: { type: "integer" },
        },
      },
      Submission: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          event_id: { type: "string", format: "uuid" },
          team_name: { type: "string" },
          title: { type: "string" },
          tagline: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          repo_url: { type: "string", nullable: true },
          demo_url: { type: "string", nullable: true },
          video_url: { type: "string", nullable: true },
          tags: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["draft", "submitted", "withdrawn"] },
        },
      },
      Error: { type: "object", properties: { error: { type: "string" } } },
    },
  },
  paths: {
    "/api/openapi.json": {
      get: { summary: "This specification", security: [], responses: { "200": { description: "OpenAPI document" } } },
    },
    "/api/health/live": {
      get: { summary: "Liveness probe", security: [], responses: { "200": { description: "Process is running" } } },
    },
    "/api/health/ready": {
      get: { summary: "Readiness probe (database migrated and reachable)", security: [], responses: { "200": { description: "Readiness report" } } },
    },
    "/api/health/version": {
      get: { summary: "App, rubric, and algorithm versions", security: [], responses: { "200": { description: "Version report" } } },
    },
    "/api/events": {
      get: { summary: "List events", security: [], responses: { "200": { description: "Events" } } },
    },
    "/api/events/{id}": {
      get: {
        summary: "Event with tracks, criteria, and prizes",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Event detail" }, "404": { description: "Not found" } },
      },
    },
    "/api/submissions": {
      get: {
        summary: "List submitted projects (optional ?eventId=)",
        security: [],
        responses: { "200": { description: "Submitted projects" } },
      },
      post: {
        summary: "Create or update a project (draft or submitted; deadline enforced)",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Submission" } } } },
        responses: { "201": { description: "Created" }, "401": { description: "Sign in required" }, "422": { description: "Deadline or validation" } },
      },
    },
    "/api/submissions/{id}": {
      get: {
        summary: "One submitted project with media and custom answers",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Project" }, "404": { description: "Not found" } },
      },
    },
    "/api/reviews": {
      post: {
        summary: "Save a draft or submit a review (ownership, ranges, and track scope enforced)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["assignmentId", "scores"],
                properties: {
                  assignmentId: { type: "string", format: "uuid" },
                  comment: { type: "string" },
                  submit: { type: "boolean" },
                  scores: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { criterionId: { type: "string", format: "uuid" }, value: { type: "number" } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Saved" }, "401": { description: "Sign in required" }, "403": { description: "Not your assignment" } },
      },
    },
    "/api/leaderboard": {
      get: {
        summary: "Raw vs normalized leaderboard (organizers only)",
        parameters: [{ name: "eventId", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Leaderboard" }, "403": { description: "Organizers only" } },
      },
    },
    "/api/standings": {
      get: {
        summary: "Community standings (hidden until published, organizers always see)",
        security: [],
        parameters: [{ name: "eventId", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Standings or {published:false}" } },
      },
    },
    "/api/votes": {
      post: {
        summary: "Cast community votes (rate-limited, duplicates collapse, never touches judge scores)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["eventId", "submissionId"],
                properties: {
                  eventId: { type: "string", format: "uuid" },
                  submissionId: { type: "string", format: "uuid" },
                  votes: { type: "integer", minimum: 1, maximum: 5 },
                  voterEmail: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Counted" }, "422": { description: "Voting closed" }, "429": { description: "Rate limited" } },
      },
    },
    "/api/comments": {
      get: {
        summary: "Public comments for a project",
        security: [],
        parameters: [{ name: "submissionId", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Comments" } },
      },
      post: {
        summary: "Post a comment (signed in, rate-limited)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["submissionId", "body"],
                properties: { submissionId: { type: "string", format: "uuid" }, body: { type: "string", maxLength: 1000 } },
              },
            },
          },
        },
        responses: { "201": { description: "Posted" }, "429": { description: "Rate limited" } },
      },
    },
    "/api/export.json": {
      get: {
        summary: "Full event dump for migration (organizers only) — leave as easily as you arrived",
        parameters: [{ name: "eventId", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Event dump" }, "403": { description: "Organizers only" } },
      },
    },
    "/api/import.json": {
      post: {
        summary: "Bulk-import up to 200 projects as drafts (organizers only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["eventId", "projects"],
                properties: {
                  eventId: { type: "string", format: "uuid" },
                  projects: { type: "array", maxItems: 200, items: { $ref: "#/components/schemas/Submission" } },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Imported" }, "403": { description: "Organizers only" } },
      },
    },
    "/api/auth/signup": {
      post: {
        summary: "Create a local account (session cookie set)",
        security: [],
        responses: { "200": { description: "Signed up" }, "400": { description: "Invalid input" } },
      },
    },
    "/api/auth/signin": {
      post: {
        summary: "Sign in (session cookie set)",
        security: [],
        responses: { "200": { description: "Signed in" }, "401": { description: "Bad credentials" } },
      },
    },
    "/api/auth/signout": {
      post: { summary: "Sign out (session destroyed)", responses: { "200": { description: "Signed out" } } },
    },
    "/api/auth/me": {
      get: { summary: "Current session user", responses: { "200": { description: "User or null" } } },
    },
  },
} as const;
