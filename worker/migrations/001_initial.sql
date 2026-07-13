-- 001_initial.sql — D1 schema for IELTS Beach sync

CREATE TABLE IF NOT EXISTS progress (
    sync_key TEXT NOT NULL,
    word_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (sync_key, word_id)
);

CREATE TABLE IF NOT EXISTS favorites (
    sync_key TEXT NOT NULL,
    fav_id TEXT NOT NULL,
    word TEXT NOT NULL DEFAULT '',
    sentence TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
    saved_at TEXT NOT NULL DEFAULT (datetime('now')),
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (sync_key, fav_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_timestamp ON progress(sync_key, timestamp);
CREATE INDEX IF NOT EXISTS idx_favorites_timestamp ON favorites(sync_key, timestamp);
