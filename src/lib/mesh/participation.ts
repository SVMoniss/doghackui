import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

import { meshPool } from "./db";

export type ParticipationRecord = {
  id: string;
  judgeId: string;
  eventId: string;
  submissionId: string;
  assignmentId: string;
  submittedAt: string;
};

/** Platform signing key, generated lazily once per deployment. */
async function platformKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pool = meshPool();
  const { rows } = await pool.query("select public_key, private_key from public.platform_keys where id = 'default'");
  const existing = rows[0] as { public_key: string; private_key: string } | undefined;
  if (existing) return { publicKey: existing.public_key, privateKey: existing.private_key };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await pool.query(
    "insert into public.platform_keys (id, public_key, private_key) values ('default', $1, $2) on conflict (id) do nothing",
    [publicPem, privatePem],
  );
  const { rows: reread } = await pool.query(
    "select public_key, private_key from public.platform_keys where id = 'default'",
  );
  const row = reread[0] as { public_key: string; private_key: string };
  return { publicKey: row.public_key, privateKey: row.private_key };
}

function payloadOf(record: ParticipationRecord): string {
  return JSON.stringify({
    judgeId: record.judgeId,
    eventId: record.eventId,
    submissionId: record.submissionId,
    assignmentId: record.assignmentId,
    submittedAt: record.submittedAt,
  });
}

/**
 * Issue a signed participation record for a submitted review. Idempotent
 * per assignment — resubmits keep the original record.
 */
export async function issueParticipationRecord(input: {
  judgeId: string;
  eventId: string;
  submissionId: string;
  assignmentId: string;
}): Promise<{ id: string; signature: string }> {
  const pool = meshPool();
  const submittedAt = new Date().toISOString();
  const { privateKey } = await platformKeys();
  const signature = sign(null, Buffer.from(payloadOf({ ...input, submittedAt }), "utf8"), privateKey).toString("hex");
  const { rows } = await pool.query(
    `insert into public.participation_records
       (judge_id, event_id, submission_id, assignment_id, submitted_at, signature)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (assignment_id) do update set signature = excluded.signature
     returning id`,
    [input.judgeId, input.eventId, input.submissionId, input.assignmentId, submittedAt, signature],
  );
  return { id: (rows[0] as { id: string }).id, signature };
}

/** Verify a record against the platform public key. Public — no auth. */
export async function verifyParticipationRecord(
  id: string,
): Promise<{ valid: boolean; record: ParticipationRecord | null; publicKey: string | null }> {
  const pool = meshPool();
  const { rows } = await pool.query(
    "select id, judge_id, event_id, submission_id, assignment_id, submitted_at, signature from public.participation_records where id = $1",
    [id],
  );
  const row = rows[0] as
    | {
        id: string;
        judge_id: string;
        event_id: string;
        submission_id: string;
        assignment_id: string;
        submitted_at: Date | string;
        signature: string;
      }
    | undefined;
  if (!row) return { valid: false, record: null, publicKey: null };
  const { publicKey } = await platformKeys();
  const record: ParticipationRecord = {
    id: row.id,
    judgeId: row.judge_id,
    eventId: row.event_id,
    submissionId: row.submission_id,
    assignmentId: row.assignment_id,
    submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at,
  };
  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(payloadOf(record), "utf8"),
      createPublicKey(publicKey),
      Buffer.from(row.signature, "hex"),
    );
  } catch {
    valid = false;
  }
  return { valid, record, publicKey };
}
