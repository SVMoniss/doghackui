import { expect, test } from "@playwright/test";

const SEEDED_SUBMISSION = "55555555-0000-0000-0000-000000000001";

test("observatory requires a session", async ({ page }) => {
  await page.goto("/observatory");
  await expect(page).toHaveURL(/\/auth/);
});

test("evidence receipt shows the certificate, claims, and anonymized assessments", async ({
  page,
}) => {
  await page.goto(`/organisms/${SEEDED_SUBMISSION}`);
  await expect(page.getByRole("heading", { name: /contestable decision receipt/i })).toBeVisible();
  // One of the two possible verdicts, computed live from the fixture data.
  await expect(page.getByText(/this prize boundary is (robust|fragile)/i)).toBeVisible();
  // Claim statuses are visible per claim.
  await expect(page.getByText("offline_operation", { exact: true })).toBeVisible();
  await expect(page.getByText("test_coverage_claim", { exact: true })).toBeVisible();
  // Judges stay anonymous on the receipt.
  await expect(page.getByText("Assessor A").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("seed-judge-a");
  // Six modalities: coverage table, milestone timeline, trace/scene viewers.
  await expect(page.getByRole("heading", { name: /evidence modalities/i })).toBeVisible();
  await expect(page.getByText(/claim-evidence graph/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /milestone timeline/i })).toBeVisible();
  await expect(page.getByText("milestone_sealed_001").first()).toBeVisible();
  await expect(page.getByText(/interaction_trace_attached_/).first()).toBeVisible();
  await expect(page.getByText(/spatial_demo_scene_attached_/).first()).toBeVisible();
  await expect(page.getByText("participant-supplied").first()).toBeVisible();
});

test("evidence receipt explains an unknown project", async ({ page }) => {
  await page.goto("/organisms/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: /no evidence receipt/i })).toBeVisible();
});
