ALTER TABLE organizations ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unsubmitted';
ALTER TABLE organizations ADD COLUMN demo_expires_at INTEGER;
UPDATE organizations SET verification_status='verified' WHERE verified=1;

CREATE TABLE organizer_accounts (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE organization_members (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 account_id TEXT NOT NULL REFERENCES organizer_accounts(id),
 role TEXT NOT NULL CHECK(role IN ('admin','manager','reviewer')),
 can_view_contacts INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 UNIQUE(organization_id,account_id)
);
CREATE TABLE organizer_sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES organizer_accounts(id), expires_at INTEGER NOT NULL
);
CREATE TABLE organizer_invitations (
 token_hash TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 email TEXT NOT NULL, role TEXT NOT NULL, can_view_contacts INTEGER NOT NULL DEFAULT 0,
 task_ids TEXT NOT NULL DEFAULT '[]', expires_at INTEGER NOT NULL, used_at TEXT
);
CREATE TABLE organizer_rate_limits (id TEXT PRIMARY KEY, hits INTEGER NOT NULL CHECK(hits>0), expires_at INTEGER NOT NULL);
ALTER TABLE tasks ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE tasks ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN capacity INTEGER;
ALTER TABLE tasks ADD COLUMN starts_at TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN ends_at TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN deadline TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN meeting_point TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE member_tasks (
 member_id TEXT NOT NULL REFERENCES organization_members(id), task_id TEXT NOT NULL REFERENCES tasks(id),
 PRIMARY KEY(member_id,task_id)
);
ALTER TABLE applications ADD COLUMN internal_note TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN reviewer_id TEXT;
CREATE TABLE organizer_activity (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, task_id TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE organizer_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
);
CREATE INDEX organizer_members_account ON organization_members(account_id,active);
CREATE INDEX organizer_activity_org ON organizer_activity(organization_id,created_at DESC);
CREATE INDEX applications_task_status ON applications(task_id,status);
CREATE INDEX organizer_sessions_expiry ON organizer_sessions(expires_at);
CREATE TRIGGER application_capacity_guard BEFORE UPDATE OF status ON applications
WHEN NEW.status='accepted' AND OLD.status='pending' AND EXISTS (
 SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.capacity IS NOT NULL
 AND (SELECT COUNT(*) FROM applications a WHERE a.task_id=t.id AND a.status='accepted') >= t.capacity
)
BEGIN SELECT RAISE(ABORT, 'organizer_capacity_full'); END;
CREATE TRIGGER organizer_last_admin BEFORE UPDATE OF role,active ON organization_members
WHEN OLD.role='admin' AND OLD.active=1 AND (NEW.role!='admin' OR NEW.active=0)
AND (SELECT COUNT(*) FROM organization_members WHERE organization_id=OLD.organization_id AND role='admin' AND active=1)<=1
BEGIN SELECT RAISE(ABORT, 'organizer_last_admin'); END;
