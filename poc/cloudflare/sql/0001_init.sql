CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','locked')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  decision_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (decision_id, person_id),
  FOREIGN KEY (decision_id) REFERENCES decisions(id)
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  author_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages_room_created ON messages (room, created_at, id);
CREATE INDEX IF NOT EXISTS ix_decisions_room_created ON decisions (room, created_at, id);
CREATE INDEX IF NOT EXISTS ix_media_room_created ON media (room, created_at, id);
