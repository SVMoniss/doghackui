import { meshPool } from "./db";

/**
 * Append-only audit trail (self-host Postgres). Logging must never break
 * the primary operation: every failure is swallowed after a best effort.
 */
export async function logAudit(input: {
  eventId?: string | null;
  actor: string;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: unknown;
}): Promise<void> {
  try {
    await meshPool().query(
      `insert into public.audit_events (event_id, actor, action, entity, entity_id, detail)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        input.eventId ?? null,
        input.actor,
        input.action,
        input.entity ?? "",
        input.entityId ?? "",
        JSON.stringify(input.detail ?? {}),
      ],
    );
  } catch {
    // Audit is best-effort by design.
  }
}
