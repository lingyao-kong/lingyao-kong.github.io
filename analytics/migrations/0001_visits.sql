CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL,
  browser TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0)
);
CREATE INDEX IF NOT EXISTS visits_time ON visits(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS visits_visitor ON visits(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS visits_source ON visits(source, created_at);
