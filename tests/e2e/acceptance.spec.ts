import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Mirrors the official run.py acceptance checker (DOGFOOD 2026, seven
 * requests) against THIS repo's real .dogfood.toml + fixtures.json, so any
 * regression fails here first — same routes, same headers, same thresholds.
 */

function repoRoot(): string {
  // Playwright runs with the repo root as cwd.
  return process.cwd();
}

function parseTomlConfig(): { base: string; auth: Record<string, string>; routes: Record<string, string> } {
  const text = readFileSync(join(repoRoot(), ".dogfood.toml"), "utf8");
  const data: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0]!.trim();
    if (!line) continue;
    const head = line.match(/^\[([A-Za-z0-9_.]+)\]$/);
    if (head) {
      section = data[head[1]!] ?? {};
      data[head[1]!] = section;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1 || !section) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    section[key] = value;
  }
  const base = (data["portal"]?.["base_url"] ?? "").replace(/\/$/, "");
  // auth values look like "Cookie: oj_session=...".
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(data["auth"] ?? {})) {
    headers[key] = value;
  }
  return { base, auth: headers, routes: data["routes"] ?? {} };
}

function headerFor(packed: string): Record<string, string> {
  const colon = packed.indexOf(":");
  return { [packed.slice(0, colon).trim()]: packed.slice(colon + 1).trim() };
}

function fixtureTitles(): string[] {
  const fixture = JSON.parse(readFileSync(join(repoRoot(), "fixtures.json"), "utf8")) as {
    projects?: { title?: string }[];
  };
  return (fixture.projects ?? []).slice(0, 3).map((p) => p.title ?? "").filter(Boolean);
}

test.describe("dogfood acceptance mirror (run.py, seven checks)", () => {
  test("T1 gallery is public", async ({ request }) => {
    const cfg = parseTomlConfig();
    const response = await request.get(`${cfg.base}${cfg.routes["gallery"]}`);
    expect(response.status()).toBe(200);
  });

  test("T1 project from fixtures shown", async ({ request }) => {
    const cfg = parseTomlConfig();
    const response = await request.get(`${cfg.base}${cfg.routes["gallery"]}`);
    const body = (await response.text()).toLowerCase();
    const titles = fixtureTitles();
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some((t) => body.includes(t.toLowerCase()))).toBe(true);
  });

  test("T1 closed event refuses submissions", async ({ request }) => {
    const cfg = parseTomlConfig();
    const response = await request.post(`${cfg.base}${cfg.routes["submit"]}`, {
      headers: { ...headerFor(cfg.auth["participant"]!), "Content-Type": "application/json" },
      data: { title: "dogfood-late-submission-probe", summary: "probe" },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test("T2 judge sees own scores", async ({ request }) => {
    const cfg = parseTomlConfig();
    const response = await request.get(`${cfg.base}${cfg.routes["judge_scores"]}`, {
      headers: headerFor(cfg.auth["judge_a"]!),
    });
    expect(response.status()).toBe(200);
  });

  test("T2 judge cannot see peer scores", async ({ request }) => {
    const cfg = parseTomlConfig();
    const peer = `${cfg.base}${cfg.routes["peer_scores"]}`;
    const response = await request.get(peer, { headers: headerFor(cfg.auth["judge_b"]!) });
    expect([401, 403]).toContain(response.status());
  });

  test("T2 participant blocked", async ({ request }) => {
    const cfg = parseTomlConfig();
    const response = await request.get(`${cfg.base}${cfg.routes["judge_scores"]}`, {
      headers: headerFor(cfg.auth["participant"]!),
    });
    expect([401, 403]).toContain(response.status());
  });

  test("T2 csv export works", async ({ request }) => {
    const cfg = parseTomlConfig();
    const response = await request.get(`${cfg.base}${cfg.routes["csv_export"]}`, {
      headers: headerFor(cfg.auth["organizer"]!),
    });
    expect(response.status()).toBe(200);
    const firstLine = (await response.text()).split("\n")[0] ?? "";
    expect(firstLine).toContain(",");
  });
});
