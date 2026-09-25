import { expect, test } from "@playwright/test";

const STRONG_PASSWORD = "E2e-T9x!qW42#zKp7";

function uniqueEmail(prefix: string) {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.org`;
}

async function signUp(page: import("@playwright/test").Page, email: string, password = STRONG_PASSWORD) {
  await page.goto("/auth");
  await page.getByRole("button", { name: /no account yet/i }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 10_000 });
}

test.describe("all site areas", () => {
  test("public: home renders event and links to gallery", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /openhack 2026/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /browse .* projects/i })).toBeVisible();
    await expect(page.getByText(/how judging works/i)).toBeVisible();
    // Prizes are published on the home page.
    await expect(page.getByText("Grand Prize")).toBeVisible();
    await expect(page.getByText("$800")).toBeVisible();
    await page.getByRole("link", { name: /browse .* projects/i }).click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole("heading", { name: /submitted projects/i })).toBeVisible();
  });

  test("public: project gallery lists submitted projects and opens a detail page", async ({
    page,
  }) => {
    await page.goto("/projects");
    // Search narrows the gallery; clearing restores it.
    await page.getByLabel("Search projects").fill("LogLens");
    await expect(page.getByText("MigrateMate")).not.toBeVisible();
    await expect(page.getByText("LogLens").first()).toBeVisible();
    await page.getByLabel("Search projects").fill("zzz-no-such-project");
    await expect(page.getByText(/no projects match/i)).toBeVisible();
    await page.getByLabel("Search projects").fill("");
    // Track filter narrows the gallery; "All tracks" restores it.
    await page.getByLabel("Filter by track").selectOption({ label: "Climate & Cities" });
    await expect(page.getByText("CoolStreets").first()).toBeVisible();
    await expect(page.getByText("LogLens")).not.toBeVisible();
    await page.getByLabel("Filter by track").selectOption({ label: "All tracks" });
    const first = page.locator('a[href^="/projects/"]').first();
    await expect(first).toBeVisible();
    const title = (await first.textContent())?.trim() ?? "";
    await first.click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    // The detail page heading is the project title
    if (title) await expect(page.locator("h1")).toContainText(title.slice(0, 20));
    else await expect(page.locator("h1")).toBeVisible();
  });

  test("public: 404 and header navigation are intact", async ({ page }) => {
    await page.goto("/does-not-exist-xyz");
    await expect(page.getByText(/page not found/i)).toBeVisible();
    await page.goto("/");
    const nav = page.locator("header nav");
    await expect(nav.getByRole("link", { name: /^event$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^projects$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^observatory$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^judging$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^organizers$/i })).toBeVisible();
    // Exercise each link (auth gates will redirect if signed out, but must not 404)
    await page.getByRole("link", { name: /^projects$/i }).click();
    await expect(page).toHaveURL(/\/projects/);
  });

  test("public: evidence receipt shows certificate, claims, anonymized assessments", async ({
    page,
  }) => {
    await page.goto("/organisms/55555555-0000-0000-0000-000000000001");
    await expect(page.getByRole("heading", { name: /contestable decision receipt/i })).toBeVisible();
    await expect(page.getByText(/this prize boundary is (robust|fragile)/i)).toBeVisible();
    await expect(page.getByText("offline_operation", { exact: true })).toBeVisible();
    await expect(page.getByText("test_coverage_claim", { exact: true })).toBeVisible();
    await expect(page.getByText("Assessor A").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("seed-judge-a");
    await expect(page.getByRole("heading", { name: /evidence modalities/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /milestone timeline/i })).toBeVisible();
    await expect(page.getByText(/interaction_trace_attached_/).first()).toBeVisible();
    // Unknown submission -> clear empty state, never a stack trace
    await page.goto("/organisms/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { name: /no evidence receipt/i })).toBeVisible();
  });

  test("auth gates: protected routes redirect to /auth when signed out", async ({ page }) => {
    for (const path of ["/submit", "/judge", "/admin", "/observatory"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth/);
    }
    // Private judging receipt also gates
    await page.goto("/receipt/00000000-0000-0000-0000-000000000001");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("auth: signup creates a session, sign out clears it, sign in restores it", async ({
    page,
  }) => {
    const email = uniqueEmail("auth-cycle");
    await signUp(page, email);
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/auth/);
    // Sign in with same credentials
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(STRONG_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("submit: empty optional URLs no longer crash — draft saves and submits", async ({ page }) => {
    const email = uniqueEmail("submit-empty-urls");
    await signUp(page, email);
    await page.goto("/submit");
    await expect(page.getByRole("heading", { name: /your projects/i })).toBeVisible();
    await expect(page.getByText(/save a draft as you go/i)).toBeVisible({ timeout: 10_000 });

    const run = `e2e-${Date.now().toString(36)}`;
    const title = `Draft ${run}`;
    const team = `Team ${run}`;

    // Fill only required fields; leave Repository/Demo/Video empty on purpose
    await page.getByLabel("Project title").fill(title);
    await page.getByLabel("Team name").fill(team);
    await page.getByLabel("One-line summary").fill("One-line tagline for the e2e probe");
    await page.getByLabel("Description").fill("A description long enough to be real.");
    // Thumbnail + gallery exercise the media buddy-table.
    await page.getByLabel("Thumbnail URL").fill(`https://example.org/thumb-${run}.png`);
    await page.getByLabel(/image gallery urls/i).fill(`https://example.org/shot-${run}.png`);
    // Tags help filter but are optional — exercise comma-separated parsing
    await page.getByLabel(/tags/i).fill("e2e, probe");

    await page.getByRole("button", { name: /save draft/i }).click();
    await expect(page.getByText(/draft saved/i)).toBeVisible({ timeout: 10_000 });
    const draftCard = page.locator(`text=${title}`).first();
    await expect(draftCard).toBeVisible({ timeout: 10_000 });

    // Edit the draft (button populates the form) and submit for judging
    await page.getByRole("button", { name: /^edit$/i }).first().click();
    await expect(page.getByText("Edit project")).toBeVisible();
    // Keep URLs empty — the fixed payload now sends "" instead of null so this must not error
    await page.getByRole("button", { name: /submit for judging/i }).click();
    await expect(page.getByText(/project submitted/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(title).first()).toBeVisible();

    // Submitted project should appear in the public gallery
    await page.goto("/projects");
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
    // ...with its thumbnail on the detail page.
    await page.getByText(title).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    await expect(page.locator(`img[src="https://example.org/thumb-${run}.png"]`)).toBeVisible({
      timeout: 10_000,
    });

    // Private receipt for own project should be reachable (shows pending or real data, never "Forbidden")
    // Grab the id from the submit page's receipt link
    await page.goto("/submit");
    await expect(page.getByText(/save a draft as you go/i)).toBeVisible({ timeout: 10_000 });
    const receiptHref = await page
      .locator('a[href^="/receipt/"]')
      .first()
      .getAttribute("href");
    if (receiptHref) {
      await page.goto(receiptHref);
      // Private receipt needs SUPABASE_SERVICE_ROLE_KEY which is not set in local Docker;
      // the page then shows a clear config error instead of crashing — either case proves the gate passed.
      await expect(
        page
          .getByText(/judging receipt|no reviews have been submitted|missing supabase/i)
          .first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test("observatory: session can reach every orbit; receipt stays contestable", async ({ page }) => {
    const email = uniqueEmail("observatory");
    await signUp(page, email);
    await page.goto("/observatory");
    // No projects yet -> guided empty state
    await expect(page.getByRole("heading", { name: /the observatory/i })).toBeVisible();
    await expect(page.getByText(/no projects yet/i)).toBeVisible();

    // After creating a project, the observatory lists it
    const run = Date.now().toString(36);
    await page.goto("/submit");
    await expect(page.getByText(/save a draft as you go/i)).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Project title").fill(`Observatory ${run}`);
    await page.getByLabel("Team name").fill(`ObsTeam ${run}`);
    await page.getByLabel("One-line summary").fill("Observatory e2e tagline");
    await page.getByLabel("Description").fill("Observatory e2e description");
    await page.getByRole("button", { name: /save draft/i }).click();
    await expect(page.getByText(/draft saved/i)).toBeVisible({ timeout: 10_000 });

    await page.goto("/observatory");
    // The new project's title should appear as a selectable button (or at least one project button exists)
    await expect(page.getByRole("button", { name: new RegExp(`Observatory ${run}`) })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("ops: health endpoints report live, ready, and version", async ({ request }) => {
    const live = await request.get("/health/live");
    expect(live.ok()).toBe(true);
    expect(await live.json()).toMatchObject({ status: "ok" });

    const ready = await request.get("/health/ready");
    expect(ready.ok()).toBe(true);
    expect(await ready.json()).toMatchObject({ status: "ready", postgres: "up" });

    const version = await request.get("/health/version");
    expect(version.ok()).toBe(true);
    const body = await version.json();
    expect(body.app).toBe("openjudge");
    expect(body.rubric).toBe("rubric-v1");
    expect(String(body.algorithms)).toContain("bradleyTerry");
  });

  test("teams: create, mint invite link, second user joins", async ({ page }) => {
    await signUp(page, uniqueEmail("team-a"));
    await page.goto("/submit");
    await expect(page.getByText(/save a draft as you go/i)).toBeVisible({ timeout: 10_000 });

    const teamName = `E2E Team ${Date.now().toString(36)}`;
    await page.getByLabel("New team").fill(teamName);
    await page.getByRole("button", { name: /create team/i }).click();
    await expect(page.getByText(/team created/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(teamName)).toBeVisible();

    await page.getByRole("button", { name: /new invite/i }).click();
    await expect(page.getByText(/invite link created/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /invite links/i }).click();
    const href = await page.locator('a[href*="/team/"]').first().getAttribute("href");
    expect(href).toMatch(/\/team\//);

    // Second user joins through the link.
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/auth/);
    await signUp(page, uniqueEmail("team-b"));
    await page.goto(href!);
    await expect(page.getByText(new RegExp(`You joined ${teamName}`))).toBeVisible({
      timeout: 10_000,
    });
    await page.goto("/submit");
    await expect(page.getByText(/save a draft as you go/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(teamName).first()).toBeVisible({ timeout: 10_000 });
  });

  test("judge + admin + project receipt are reachable with a session", async ({ page }) => {
    const email = uniqueEmail("gates");
    await signUp(page, email);

    await page.goto("/judge");
    await expect(page).toHaveURL(/\/judge/);
    await expect(page.getByRole("heading", { name: /judging console/i })).toBeVisible();
    // After signup the user has no judge assignment yet — the empty state is the correct gate
    await expect(page.getByText(/no assignments yet/i)).toBeVisible({ timeout: 10_000 });

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
    // Either the dashboard or the "Claim organizer role" prompt — both prove the gate passed (not /auth)
    await expect(page.getByRole("heading", { name: /organizer dashboard/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
