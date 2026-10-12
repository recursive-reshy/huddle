-- Huddle — migration 0002_messages_review_kind
-- Adds 'review' to messages.kind for the SA's review notes from sa_review_brief
-- (TRD v1.10, SA addition 3).
--
-- SQLite can't alter a CHECK in place, so messages is rebuilt. The runner
-- applies this file in one transaction with foreign_keys OFF and runs
-- PRAGMA foreign_key_check before committing. Don't add BEGIN, COMMIT or
-- PRAGMA statements here.
--
-- Dropping messages drops its index and its three triggers. They are
-- re-created below exactly as 0001 wrote them; 0002_messages_review_kind.test.mjs
-- asserts the schema outside messages is byte-for-byte unchanged.

CREATE TABLE messages_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread     TEXT NOT NULL REFERENCES agents(id) CHECK (thread <> 'human'),
  author     TEXT NOT NULL REFERENCES agents(id),
  kind       TEXT NOT NULL CHECK (kind IN ('chat', 'discussion', 'summary', 'system', 'review')),
  content    TEXT NOT NULL,
  job_id     INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  -- Review notes are written by the SA, in the SA thread.
  CHECK (kind <> 'review' OR (author = 'sa' AND thread = 'sa'))
);

INSERT INTO messages_new (id, project_id, thread, author, kind, content, job_id, created_at)
SELECT id, project_id, thread, author, kind, content, job_id, created_at
  FROM messages;

-- Carry the AUTOINCREMENT high-water mark across, so a message id is never
-- reused, even after a project delete has removed the newest rows.
DELETE FROM sqlite_sequence WHERE name = 'messages_new';
INSERT INTO sqlite_sequence (name, seq)
SELECT 'messages_new', seq FROM sqlite_sequence WHERE name = 'messages';

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

-- Re-created verbatim from 0001.
CREATE INDEX messages_thread ON messages (project_id, thread, id);

-- US-22: Naresh can only open a discussion at a gate or while ESCALATED.
-- Agent replies are not checked, so a reply already in flight still lands
-- after the project leaves the gate.
CREATE TRIGGER messages_discussion_state
BEFORE INSERT ON messages
WHEN NEW.kind = 'discussion' AND NEW.author = 'human'
 AND (SELECT current_state FROM projects WHERE id = NEW.project_id)
     NOT IN ('GATE_BRIEF', 'GATE_PRD', 'GATE_TRD', 'ESCALATED')
BEGIN
  SELECT RAISE(ABORT, 'discussion is only allowed at a gate or while ESCALATED');
END;

-- job_id is left out so ON DELETE SET NULL still works.
CREATE TRIGGER messages_no_update BEFORE UPDATE OF
  project_id, thread, author, kind, content, created_at
ON messages
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;

CREATE TRIGGER messages_no_delete BEFORE DELETE ON messages
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;
