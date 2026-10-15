// Authorization is enforced here as well as by the future organizer service.
// No organizer endpoint or credentials are shipped in the volunteer client.
export async function applicationForOrganizer(
  db: D1Database,
  organizerId: string,
  id: string,
) {
  const row = await db
    .prepare(
      "SELECT a.* FROM applications a JOIN tasks t ON t.id=a.task_id JOIN organizations o ON o.id=t.organizer_id WHERE a.id=? AND o.id=? AND o.verified=1",
    )
    .bind(id, organizerId)
    .first();
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    profile: JSON.parse(String(row.profile_snapshot)),
    contacts:
      row.status === "accepted"
        ? JSON.parse(String(row.contact_snapshot))
        : null,
  };
}
