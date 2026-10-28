CREATE TABLE organizer_media (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 uploaded_by TEXT NOT NULL REFERENCES organizer_accounts(id),
 object_key TEXT NOT NULL UNIQUE,
 url TEXT NOT NULL UNIQUE,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size>0),
 filename TEXT NOT NULL,
 ready INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE INDEX organizer_media_org ON organizer_media(organization_id,created_at);
