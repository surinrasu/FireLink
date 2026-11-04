import { timestamp } from "./domain";

type ExpiryScope = { organizationId: string } | { userId: string };

/** Pending applications expire at the task end, never at the signup deadline.
 * The database trigger writes the notification and audit record atomically.
 * Repeated requests and concurrent scheduled runs cannot notify twice.
 */
export async function expireApplications(
  db: D1Database,
  scope?: ExpiryScope,
  now = timestamp(),
) {
  const organization = scope && "organizationId" in scope;
  const user = scope && "userId" in scope;
  await db
    .prepare(
      `UPDATE applications SET status='expired',updated_at=?,reviewer_id=NULL
       WHERE status='pending' AND task_id IN (
         SELECT id FROM tasks WHERE ends_at!='' AND ends_at<=?
         ${organization ? "AND organizer_id=?" : ""}
       ) ${user ? "AND user_id=?" : ""}`,
    )
    .bind(
      now,
      now,
      ...(organization ? [scope.organizationId] : user ? [scope.userId] : []),
    )
    .run();
}
