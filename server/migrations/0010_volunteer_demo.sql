CREATE TABLE demo_volunteers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX demo_volunteers_organization ON demo_volunteers(organization_id);
