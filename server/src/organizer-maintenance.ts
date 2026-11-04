import { cleanupMedia } from "./organizer-media";
/** Delete only explicitly expired demo tenants. Real organizations never match. */
export async function cleanupOrganizerData(
  db: D1Database,
  now = Date.now(),
  files?: Pick<R2Bucket, "delete">,
) {
  if (files) await cleanupMedia(db, files, now);
  const expired =
    "SELECT id FROM organizations WHERE demo_expires_at IS NOT NULL AND demo_expires_at<=? ORDER BY demo_expires_at LIMIT 100";
  const tasks = `SELECT id FROM tasks WHERE organizer_id IN (${expired})`;
  const members = `SELECT id FROM organization_members WHERE organization_id IN (${expired})`;
  if (files) {
    const credentials = await db
      .prepare(
        `SELECT c.object_key FROM credentials c JOIN demo_volunteers d ON d.user_id=c.user_id WHERE d.organization_id IN (${expired})`,
      )
      .bind(now)
      .all<{ object_key: string }>();
    for (const credential of credentials.results)
      await files.delete(credential.object_key);
  }
  await db.batch([
    db.prepare("DELETE FROM location_cache WHERE expires_at<=?").bind(now),
    db.prepare("DELETE FROM organizer_sessions WHERE expires_at<=?").bind(now),
    db
      .prepare("DELETE FROM organizer_rate_limits WHERE expires_at<=?")
      .bind(now),
    db
      .prepare("DELETE FROM organizer_invitations WHERE expires_at<=?")
      .bind(now),
    db
      .prepare(
        `DELETE FROM notifications WHERE application_id IN (SELECT id FROM applications WHERE task_id IN (${tasks}))`,
      )
      .bind(now),
    // Deleting demo volunteers also revokes their mobile sessions and credentials.
    db
      .prepare(
        `DELETE FROM users WHERE phone LIKE 'demo:%' AND id IN (SELECT user_id FROM applications WHERE task_id IN (${tasks})) AND NOT EXISTS (SELECT 1 FROM applications a JOIN tasks t ON t.id=a.task_id WHERE a.user_id=users.id AND (t.organizer_id NOT IN (${expired})))`,
      )
      .bind(now, now),
    db
      .prepare(`DELETE FROM applications WHERE task_id IN (${tasks})`)
      .bind(now),
    db
      .prepare(
        `DELETE FROM member_tasks WHERE task_id IN (${tasks}) OR member_id IN (${members})`,
      )
      .bind(now, now),
    db
      .prepare(`DELETE FROM tasks WHERE organizer_id IN (${expired})`)
      .bind(now),
    db
      .prepare(
        `DELETE FROM organizer_requests WHERE organization_id IN (${expired})`,
      )
      .bind(now),
    db
      .prepare(
        `DELETE FROM organizer_activity WHERE organization_id IN (${expired})`,
      )
      .bind(now),
    db
      .prepare(
        `DELETE FROM organizer_invitations WHERE organization_id IN (${expired})`,
      )
      .bind(now),
    db
      .prepare(
        `DELETE FROM organization_members WHERE organization_id IN (${expired})`,
      )
      .bind(now),
    // Real invitees may belong to other organizations: keep their accounts and sessions.
    db.prepare(
      "DELETE FROM organizer_sessions WHERE account_id IN (SELECT id FROM organizer_accounts a WHERE email LIKE '%@demo.invalid' AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.account_id=a.id))",
    ),
    db.prepare(
      "DELETE FROM organizer_accounts WHERE email LIKE '%@demo.invalid' AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.account_id=organizer_accounts.id)",
    ),
    db.prepare(`DELETE FROM organizations WHERE id IN (${expired})`).bind(now),
  ]);
}
