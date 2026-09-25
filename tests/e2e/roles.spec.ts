import { expect, test } from "@playwright/test";

const ORGANIZER = { email: "organizer@example.org", password: "openjudge" };
const JUDGE = { email: "judge@example.org", password: "openjudge" };
const LOGLENS = "55555555-0000-0000-0000-000000000001";

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 10_000 });
}

async function signUp(page: import("@playwright/test").Page, email: string) {
  await page.goto("/auth");
  await page.getByRole("button", { name: /no account yet/i }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("E2e-T9x!qW42#zKp7");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 10_000 });
}

test.describe("organizer and judge flows", () => {
  test("organizer: dashboard, leaderboard, CSV exports, freeze, audit, receipt", async ({
    page,
  }) => {
    await signIn(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /openhack 2026/i })).toBeVisible({
      timeout: 10_000,
    });

    // Leaderboard renders real rows with raw + normalized scores.
    await expect(page.getByText("LogLens").first()).toBeVisible({ timeout: 10_000 });
    // CSV export at every stage: assignments, reviews, results.
    await expect(page.getByRole("button", { name: /export assignments csv/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /export reviews csv/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /export csv/i }).first()).toBeVisible();

    // Rubric freeze ceremony (idempotent across re-runs).
    const freezeButton = page.getByRole("button", { name: /freeze rubric/i });
    if (await freezeButton.isVisible()) {
      await freezeButton.click();
      await expect(page.getByText(/rubric frozen/i).first()).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(page.getByText(/rubric frozen/i).first()).toBeVisible();
    }

    // Audit trail records fresh actions (create a prize: additive, harmless).
    const prizeTitle = `E2E Prize ${Date.now().toString(36)}`;
    await page.getByLabel("Title").fill(prizeTitle);
    await page.getByLabel("Amount").fill("$1");
    await page.getByRole("button", { name: /add prize/i }).click();
    await expect(page.getByText(/prize added/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("prize.created").first()).toBeVisible({ timeout: 10_000 });

    // Published private receipt for a judged project, judges anonymized.
    await page.goto(`/receipt/${LOGLENS}`);
    await expect(page.getByRole("heading", { name: /loglens/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Judge A").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Ada Reyes");

    // Access control is visible to admins (demo organizer is also admin).
    await page.goto("/admin");
    await expect(page.getByText("Access control")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("organizer@example.org").first()).toBeVisible();
  });

  test("judge: queue, draft, and submit a review with local session", async ({ page }) => {
    await signIn(page, JUDGE.email, JUDGE.password);
    await page.goto("/judge");
    await expect(page.getByRole("heading", { name: /judging console/i })).toBeVisible({
      timeout: 10_000,
    });
    // Seeded draft assignment for the demo judge.
    const assignment = page.getByRole("button", { name: /migratemate/i });
    await expect(assignment).toBeVisible({ timeout: 10_000 });
    await assignment.click();

    // Fill every criterion, save a draft first (exercises the draft path).
    const scores: [RegExp, string][] = [
      [/^impact/i, "8"],
      [/^innovation/i, "7"],
      [/^technical execution/i, "9"],
      [/^design/i, "7"],
      [/^presentation/i, "8"],
    ];
    for (const [label, value] of scores) {
      await page.getByLabel(label).fill(value);
    }
    await page.getByLabel(/overall feedback/i).fill("Careful scope, honest demo.");
    await page.getByRole("button", { name: /^save draft$/i }).click();
    await expect(page.getByText(/draft saved/i)).toBeVisible({ timeout: 10_000 });

    // Scores survive reload (draft persistence across sessions).
    await page.reload();
    await expect(page.getByRole("heading", { name: /judging console/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /migratemate/i }).click();
    await expect(page.getByLabel(/^impact/i)).toHaveValue("8");

    // Submit the review for real.
    await page.getByRole("button", { name: /^submit review$/i }).click();
    await expect(page.getByText(/review submitted/i)).toBeVisible({ timeout: 10_000 });

    // Pairwise mode: pick a winner, twice for a stable signal.
    for (let round = 0; round < 2; round += 1) {
      const duel = page.getByText(/head-to-head/i);
      await expect(duel).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /wins$/i }).first().click();
      await expect(page.getByText(/pairwise vote recorded/i)).toBeVisible({ timeout: 10_000 });
    }

    // Organizer sees the votes in the Bradley-Terry ranking.
    await page.getByRole("button", { name: /sign out/i }).click();
    await signIn(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto("/admin");
    await expect(page.getByText(/head-to-head votes counted/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("rubric: create event, reweight within 1.00, freeze locks edits", async ({ page }) => {
    await signIn(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto("/admin");

    // Fresh event so the frozen seed event never interferes.
    const run = Date.now().toString(36).replace(/[^a-z0-9]/g, "");
    const eventName = `E2E Rubric ${run}`;
    await page.locator("#event-name").fill(eventName);
    await page.locator("#event-slug").fill(`e2e-rubric-${run}`);
    await page.locator("#event-tracks").fill("Test Track");
    await page.getByRole("button", { name: /create event/i }).click();
    await expect(page.getByText(/event created/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: eventName })).toBeVisible({ timeout: 10_000 });

    // Default five criteria are seeded; tweak two weights keeping sum 1.00.
    await expect(page.getByText("Impact", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Weight for Innovation").fill("0.25");
    await page.getByLabel("Weight for Design").fill("0.1");
    await page.getByRole("button", { name: /save weights/i }).click();
    await expect(page.getByText(/rubric weights saved/i)).toBeVisible({ timeout: 10_000 });

    // Freeze locks the rubric: the save button disables.
    await page.getByRole("button", { name: /freeze rubric/i }).click();
    await expect(page.getByText(/rubric frozen/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /save weights/i })).toBeDisabled();
  });

  test("questions: organizer adds one, answers show on the detail page", async ({ page }) => {
    await signIn(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto("/admin");
    const label = `What should judges try first? (${Date.now().toString(36)})`;
    await page.getByLabel("Label").fill(label);
    await page.getByLabel("Kind").selectOption("text");
    await page.getByRole("button", { name: /add question/i }).click();
    await expect(page.getByText(/question added/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(label)).toBeVisible();

    // Answer it while submitting, then read it back publicly.
    const run = Date.now().toString(36);
    await page.goto("/submit");
    await expect(page.getByText(/save a draft as you go/i)).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Project title").fill(`Q&A ${run}`);
    await page.getByLabel("Team name").fill(`QATeam ${run}`);
    await page.getByLabel("One-line summary").fill("Custom question e2e");
    await page.getByLabel("Description").fill("Answering the organizer question.");
    await page.getByLabel(label).fill("The cold-start replay capsule.");
    await page.getByRole("button", { name: /submit for judging/i }).click();
    await expect(page.getByText(/project submitted/i)).toBeVisible({ timeout: 10_000 });
    await page.goto("/projects");
    await page.getByText(`Q&A ${run}`).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    await expect(page.getByText("The cold-start replay capsule.")).toBeVisible({ timeout: 10_000 });
  });

  test("community: vote hidden until published, comments work", async ({ page }) => {
    await signIn(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto("/admin");
    await page.getByLabel("Mode").selectOption("one_person_one_vote");
    await page.getByRole("checkbox", { name: /voting open/i }).check();
    await page.getByRole("checkbox", { name: /results published/i }).uncheck();
    await page.getByRole("button", { name: /save voting/i }).click();
    await expect(page.getByText(/voting settings saved/i)).toBeVisible({ timeout: 10_000 });

    // Participant votes; standings stay hidden.
    await page.getByRole("button", { name: /sign out/i }).click();
    const participant = `e2e-voter-${Date.now()}@example.org`;
    await signUp(page, participant);
    await page.goto("/vote");
    await page.getByRole("button", { name: /^vote$/i }).first().click();
    await expect(page.getByText(/vote counted/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/results are hidden/i)).toBeVisible();

    // Comment on a project detail page.
    await page.goto(`/projects/${LOGLENS}`);
    const comment = `e2e comment ${Date.now()}`;
    await page.getByLabel(/write a comment/i).fill(comment);
    await page.getByRole("button", { name: /^post comment$/i }).click();
    await expect(page.getByText(/comment posted/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(comment)).toBeVisible();

    // Organizer publishes; tally becomes public.
    await page.getByRole("button", { name: /sign out/i }).click();
    await signIn(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto("/admin");
    await page.getByRole("checkbox", { name: /results published/i }).check();
    await page.getByRole("button", { name: /save voting/i }).click();
    await expect(page.getByText(/voting settings saved/i)).toBeVisible({ timeout: 10_000 });
    await page.goto("/vote");
    await expect(page.getByText(/ballots/i).first()).toBeVisible({ timeout: 10_000 });

    // Leave voting as found (closed) for other runs.
    await page.goto("/admin");
    await page.getByLabel("Mode").selectOption("off");
    await page.getByRole("button", { name: /save voting/i }).click();
    await expect(page.getByText(/voting settings saved/i)).toBeVisible({ timeout: 10_000 });
  });

  test("api first: openapi, rest reads, auth gates, embed, webhooks", async ({
    page,
    request,
  }) => {
    const spec = await request.get("/api/openapi.json");
    expect(spec.ok()).toBe(true);
    const body = await spec.json();
    expect(Object.keys(body.paths)).toContain("/api/submissions");
    expect(Object.keys(body.paths)).toContain("/api/reviews");
    expect(JSON.stringify(body)).toContain("cookieAuth");

    const list = await request.get("/api/submissions");
    expect(list.ok()).toBe(true);
    expect(((await list.json()) as { submissions: unknown[] }).submissions.length).toBeGreaterThan(0);

    const denied = await request.post("/api/submissions", { data: { title: "x" } });
    expect(denied.status()).toBe(401);

    // Embeddable gallery renders without chrome.
    await page.goto("/embed/gallery");
    await expect(page.getByText("LogLens").first()).toBeVisible({ timeout: 10_000 });

    // Webhook: organizer registers an unreachable endpoint, a submission
    // triggers a logged (failed) delivery — proof the fan-out fires.
    await signIn(page, ORGANIZER.email, ORGANIZER.password);
    await page.goto("/admin");
    await page.getByLabel("Endpoint URL").fill(`https://example.org/hook-${Date.now()}`);
    await page.getByRole("button", { name: /add webhook/i }).click();
    await expect(page.getByText(/webhook created/i)).toBeVisible({ timeout: 10_000 });

    const run = Date.now().toString(36);
    await page.goto("/submit");
    await expect(page.getByText(/save a draft as you go/i)).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Project title").fill(`Webhook ${run}`);
    await page.getByLabel("Team name").fill(`WHTeam ${run}`);
    await page.getByLabel("One-line summary").fill("Webhook e2e");
    await page.getByLabel("Description").fill("Triggering a webhook delivery.");
    await page.getByRole("button", { name: /submit for judging/i }).click();
    await expect(page.getByText(/project submitted/i)).toBeVisible({ timeout: 10_000 });
    await page.goto("/admin");
    await expect(page.getByText(/failed deliveries/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
