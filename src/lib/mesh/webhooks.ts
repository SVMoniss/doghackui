import { createHmac } from "node:crypto";

import { meshPool } from "./db";

export const WEBHOOK_EVENTS = [
  "submission.submitted",
  "review.submitted",
  "voting.published",
  "eligibility.decided",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Best-effort webhook fan-out: HMAC-signed POSTs with a short timeout,
 * every attempt logged. Never throws — judging never depends on receivers.
 */
export async function triggerWebhooks(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  try {
    const pool = meshPool();
    const eventId = payload["eventId"];
    if (typeof eventId !== "string") return;
    const { rows } = await pool.query(
      `select id, url, secret from public.webhook_subscriptions
       where event_id = $1 and active = true and ($2 = any (events) or events = '{}')`,
      [eventId, event],
    );
    for (const sub of rows as { id: string; url: string; secret: string }[]) {
      const body = JSON.stringify({ event, at: new Date().toISOString(), ...payload });
      const signature = createHmac("sha256", sub.secret).update(body, "utf8").digest("hex");
      let status: "delivered" | "failed" = "failed";
      let lastError = "";
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const response = await fetch(sub.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-OpenJudge-Event": event,
              "X-OpenJudge-Signature": `sha256=${signature}`,
            },
            body,
            signal: controller.signal,
          });
          if (response.ok) status = "delivered";
          else lastError = `HTTP ${response.status}`;
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        lastError = String((error as Error)?.message ?? error).slice(0, 300);
      }
      await pool
        .query(
          `insert into public.webhook_deliveries (subscription_id, event, payload, status, attempts, last_error)
           values ($1, $2, $3, $4, 1, $5)`,
          [sub.id, event, body, status, lastError],
        )
        .catch(() => undefined);
    }
  } catch {
    // Webhooks never break the operation that triggered them.
  }
}
