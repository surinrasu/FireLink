ALTER TABLE incidents ADD COLUMN address TEXT NOT NULL DEFAULT '';
CREATE TABLE location_cache (id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX location_cache_expiry ON location_cache(expires_at);
