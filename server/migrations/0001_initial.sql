PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, profile TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, contact TEXT);
CREATE TABLE incidents (id TEXT PRIMARY KEY, title TEXT NOT NULL, region TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id), organizer_id TEXT NOT NULL REFERENCES organizations(id), title TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, blocks TEXT NOT NULL, required_fields TEXT NOT NULL, contact_fields TEXT NOT NULL);
CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, category TEXT NOT NULL, minutes INTEGER NOT NULL, blocks TEXT NOT NULL);
CREATE TABLE credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, object_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'uploaded', created_at TEXT NOT NULL);
CREATE TABLE applications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_id TEXT NOT NULL REFERENCES tasks(id), status TEXT NOT NULL DEFAULT 'pending',
 profile_snapshot TEXT NOT NULL, contact_snapshot TEXT NOT NULL, consent_version INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, response TEXT,
 UNIQUE(user_id, task_id)
);
CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, application_id TEXT, created_at TEXT NOT NULL, read_at TEXT);
CREATE TABLE passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX applications_user ON applications(user_id, created_at DESC);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX tasks_incident ON tasks(incident_id, updated_at DESC);
CREATE INDEX challenges_expiry ON challenges(expires_at);
