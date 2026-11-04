ALTER TABLE incidents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE incidents ADD COLUMN demo_organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX incidents_demo ON incidents(demo_organization_id, updated_at DESC);

/* Existing demo tasks must use isolated copies before event editing is enabled. */
INSERT INTO incidents(id,title,region,latitude,longitude,status,updated_at,version,demo_organization_id)
SELECT o.id || ':' || i.id,i.title,i.region,i.latitude,i.longitude,i.status,i.updated_at,i.version,o.id
FROM organizations o CROSS JOIN incidents i
WHERE o.demo_expires_at IS NOT NULL AND i.demo_organization_id IS NULL;
UPDATE tasks SET incident_id=organizer_id || ':' || incident_id
WHERE organizer_id IN (SELECT id FROM organizations WHERE demo_expires_at IS NOT NULL);
