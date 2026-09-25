import { expect, test } from "@playwright/test";

test("event home shows the event and links to the gallery", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await page.getByRole("link", { name: /projects/i }).first().click();
  await expect(page).toHaveURL(/\/projects/);
});

test("project gallery lists submitted projects and opens a detail page", async ({ page }) => {
  await page.goto("/projects");
  const first = page.locator('a[href^="/projects/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  await expect(page.locator("h1")).toBeVisible();
});

test("judging console requires a session", async ({ page }) => {
  await page.goto("/judge");
  await expect(page).toHaveURL(/\/auth/);
});

test("organizer dashboard requires a session", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/auth/);
});

test("submitting a project requires a session", async ({ page }) => {
  await page.goto("/submit");
  await expect(page).toHaveURL(/\/auth/);
});
