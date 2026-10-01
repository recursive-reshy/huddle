-- My Team — migration 0001_init (rev 3: US-22 gate discussion; last in-place change)
-- Target: SQLite 3.38+ via better-sqlite3 + Drizzle (plain SQL migrations).
-- Connection pragmas (set by the app on every connection, not here):
--   journal_mode=WAL, foreign_keys=ON, busy_timeout=5000
-- Conventions:
--   * Timestamps are INTEGER epoch milliseconds (UTC).
--   * Entity ids are app-generated TEXT (ULIDs); log tables use INTEGER ids.
--   * Money is INTEGER micro-dollars (1 USD = 1_000_000).
--   * JSON is TEXT checked with json_valid().

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
CREATE TABLE agents (
  id   TEXT PRIMARY KEY,               -- 'human', 'pm', 'sa', 'dba', 'ca'
  name TEXT NOT NULL
);

INSERT INTO agents (id, name) VALUES
  ('human', 'Owner'),
  ('pm',    'Product Manager'),
  ('sa',    'Solutions Architect'),
  ('dba',   'DBA'),
  ('ca',    'Cloud Architect');

-- ---------------------------------------------------------------------------
-- Projects and workflow state
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(name) > 0),
  current_state TEXT NOT NULL CHECK (current_state IN (
                  'DISCOVERY', 'BRIEF_DRAFT', 'GATE_BRIEF', 'SA_REVIEW',
                  'PRD_DRAFT', 'GATE_PRD', 'TRD_DRAFT', 'GATE_TRD',
                  'DONE', 'ESCALATED')),
  state_rev     INTEGER NOT NULL DEFAULT 0 CHECK (state_rev >= 0), -- optimistic lock
  created_at    INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  updated_at    INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

-- ---------------------------------------------------------------------------
-- Versioned artifacts
-- ---------------------------------------------------------------------------
CREATE TABLE artifacts (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('brief', 'prd', 'trd')),
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  UNIQUE (project_id, kind)
);

CREATE TABLE artifact_versions (
  artifact_id    TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL CHECK (version >= 1),
  parent_version INTEGER,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'approved', 'superseded', 'discarded')),
  created_by     TEXT NOT NULL REFERENCES agents(id),
  created_at     INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  approved_at    INTEGER,
  PRIMARY KEY (artifact_id, version),
  FOREIGN KEY (artifact_id, parent_version) REFERENCES artifact_versions(artifact_id, version),
  CHECK (parent_version IS NULL OR parent_version < version),
  CHECK ((status IN ('approved', 'superseded')) = (approved_at IS NOT NULL))
);

-- At most one approved and one open draft per artifact.
CREATE UNIQUE INDEX artifact_versions_one_approved
  ON artifact_versions (artifact_id) WHERE status = 'approved';
CREATE UNIQUE INDEX artifact_versions_one_draft
  ON artifact_versions (artifact_id) WHERE status = 'draft';

CREATE TABLE artifact_sections (
  artifact_id TEXT NOT NULL,
  version     INTEGER NOT NULL,
  section_key TEXT NOT NULL CHECK (length(section_key) > 0),
  ordinal     INTEGER NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  author      TEXT NOT NULL REFERENCES agents(id),   -- e.g. 'dba' writes the TRD data section
  PRIMARY KEY (artifact_id, version, section_key),
  FOREIGN KEY (artifact_id, version)
    REFERENCES artifact_versions(artifact_id, version) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Job queue
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN (
                     'pm_discovery_reply', 'pm_draft_brief', 'sa_review_brief',
                     'clarification_round', 'loop_summary',
                     'pm_draft_prd', 'sa_draft_trd', 'revise_artifact',
                     'agent_chat_reply')),
  agent            TEXT NOT NULL REFERENCES agents(id),
  status           TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input)),
  result           TEXT CHECK (result IS NULL OR json_valid(result)),
  error            TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  run_after        INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  locked_at        INTEGER,
  lease_expires_at INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  finished_at      INTEGER,
  -- Each kind runs on the agent the workflow assigns it.
  CHECK (CASE kind
           WHEN 'clarification_round' THEN agent IN ('pm', 'sa')
           WHEN 'revise_artifact'     THEN agent IN ('pm', 'sa')
           WHEN 'agent_chat_reply'    THEN agent IN ('pm', 'sa')
           WHEN 'loop_summary'        THEN agent = 'sa'
           WHEN 'sa_review_brief'     THEN agent = 'sa'
           WHEN 'sa_draft_trd'        THEN agent = 'sa'
           ELSE agent = 'pm'
         END),
  CHECK ((status = 'running') = (lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL))
);

CREATE INDEX jobs_ready   ON jobs (run_after, id)       WHERE status = 'queued';
CREATE INDEX jobs_leases  ON jobs (lease_expires_at)    WHERE status = 'running';
CREATE INDEX jobs_project ON jobs (project_id, id);

-- ---------------------------------------------------------------------------
-- Messages (discovery chat, per-agent threads, loop summaries)
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread     TEXT NOT NULL REFERENCES agents(id) CHECK (thread <> 'human'),
  author     TEXT NOT NULL REFERENCES agents(id),
  kind       TEXT NOT NULL CHECK (kind IN ('chat', 'discussion', 'summary', 'system')),
  content    TEXT NOT NULL,
  job_id     INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

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

-- ---------------------------------------------------------------------------
-- Event log (history + UI stream). Replaces state_transitions.
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,      -- never reused: safe as the stream cursor
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN (
               'StateTransitioned', 'GateSentBack',
               'JobClaimed', 'JobCompleted', 'JobFailed',
               'MessageCompleted',
               'ArtifactVersionCreated', 'ArtifactVersionApproved',
               'ClarificationAsked', 'ClarificationAnswered', 'ClarificationEscalated',
               'DecisionRecorded')),
  actor      TEXT REFERENCES agents(id),              -- NULL = system
  payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

CREATE INDEX events_project_id ON events (project_id, id);

-- Payload shape for the event types other code depends on.
CREATE TRIGGER events_payload_shape
BEFORE INSERT ON events
WHEN (NEW.type = 'StateTransitioned' AND (
          json_type(NEW.payload, '$.from')      IS NOT 'text'
       OR json_type(NEW.payload, '$.to')        IS NOT 'text'
       OR json_type(NEW.payload, '$.trigger')   IS NOT 'text'
       OR json_type(NEW.payload, '$.state_rev') IS NOT 'integer'))
  OR (NEW.type = 'MessageCompleted' AND json_type(NEW.payload, '$.message_id') IS NOT 'integer')
  OR (NEW.type = 'GateSentBack'     AND json_type(NEW.payload, '$.notes')      IS NOT 'text')
BEGIN
  SELECT RAISE(ABORT, 'event payload is missing required fields for its type');
END;

-- ---------------------------------------------------------------------------
-- Clarifications and decisions
-- ---------------------------------------------------------------------------
CREATE TABLE clarifications (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread_id        TEXT NOT NULL,                     -- one agent-to-agent loop
  round            INTEGER NOT NULL CHECK (round >= 1),
  from_agent       TEXT NOT NULL REFERENCES agents(id),
  to_agent         TEXT NOT NULL REFERENCES agents(id),
  question         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'answered', 'deferred', 'escalated')),
  answer           TEXT,                              -- for 'deferred': the working assumption
  answered_by      TEXT REFERENCES agents(id),
  artifact_id      TEXT,
  artifact_version INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  answered_at      INTEGER,
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifact_versions(artifact_id, version),
  CHECK (from_agent <> to_agent),
  CHECK ((artifact_id IS NULL) = (artifact_version IS NULL)),
  CHECK ((status IN ('answered', 'deferred'))
         = (answer IS NOT NULL AND answered_by IS NOT NULL AND answered_at IS NOT NULL))
);

CREATE INDEX clarifications_thread ON clarifications (thread_id, round);
CREATE INDEX clarifications_open   ON clarifications (project_id, to_agent) WHERE status = 'open';

CREATE TABLE decisions (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  decision         TEXT NOT NULL,
  rationale        TEXT NOT NULL,
  decided_by       TEXT NOT NULL REFERENCES agents(id),
  supersedes       TEXT REFERENCES decisions(id),
  artifact_id      TEXT,
  artifact_version INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifact_versions(artifact_id, version),
  CHECK ((artifact_id IS NULL) = (artifact_version IS NULL))
);

CREATE INDEX decisions_project ON decisions (project_id, created_at);

-- ---------------------------------------------------------------------------
-- Cost tracking (survives project deletion)
-- ---------------------------------------------------------------------------
CREATE TABLE llm_calls (
  id                 INTEGER PRIMARY KEY,
  project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
  job_id             INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  agent              TEXT NOT NULL REFERENCES agents(id),
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_micro_usd     INTEGER NOT NULL CHECK (cost_micro_usd >= 0),
  created_at         INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

CREATE INDEX llm_calls_created ON llm_calls (created_at);
CREATE INDEX llm_calls_project ON llm_calls (project_id, created_at);

-- ---------------------------------------------------------------------------
-- Backups (drives the "last backup" date in the UI)
-- ---------------------------------------------------------------------------
CREATE TABLE backups (
  id         INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  bytes      INTEGER NOT NULL CHECK (bytes > 0),
  sha256     TEXT NOT NULL CHECK (length(sha256) = 64)
);

-- ---------------------------------------------------------------------------
-- Immutability guards
-- Only 'draft' content is editable. Allowed version transitions:
--   draft -> approved, draft -> discarded, approved -> superseded.
-- Deletes of frozen rows are only allowed when the parent is already gone
-- (a whole-project cascade); SQLite deletes the parent row before running
-- the cascade, which the migration test asserts.
-- ---------------------------------------------------------------------------
CREATE TRIGGER artifact_versions_frozen_update
BEFORE UPDATE ON artifact_versions
WHEN OLD.status IN ('superseded', 'discarded')
  OR (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'approved', 'discarded'))
  OR (OLD.status = 'approved' AND NEW.status <> 'superseded')
  OR NEW.artifact_id    IS NOT OLD.artifact_id
  OR NEW.version        IS NOT OLD.version
  OR NEW.parent_version IS NOT OLD.parent_version
  OR NEW.created_by     IS NOT OLD.created_by
  OR NEW.created_at     IS NOT OLD.created_at
  OR (OLD.status = 'approved' AND NEW.approved_at IS NOT OLD.approved_at)
BEGIN
  SELECT RAISE(ABORT, 'artifact version transition not allowed');
END;

CREATE TRIGGER artifact_versions_frozen_delete
BEFORE DELETE ON artifact_versions
WHEN OLD.status <> 'draft'
 AND EXISTS (SELECT 1 FROM artifacts WHERE id = OLD.artifact_id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a non-draft version');
END;

CREATE TRIGGER artifact_sections_frozen_insert
BEFORE INSERT ON artifact_sections
WHEN EXISTS (SELECT 1 FROM artifact_versions
             WHERE artifact_id = NEW.artifact_id AND version = NEW.version AND status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'cannot add sections to a non-draft version');
END;

CREATE TRIGGER artifact_sections_frozen_update
BEFORE UPDATE ON artifact_sections
WHEN EXISTS (SELECT 1 FROM artifact_versions
             WHERE artifact_id = OLD.artifact_id AND version = OLD.version AND status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'sections of a non-draft version are frozen');
END;

CREATE TRIGGER artifact_sections_frozen_delete
BEFORE DELETE ON artifact_sections
WHEN EXISTS (SELECT 1 FROM artifact_versions
             WHERE artifact_id = OLD.artifact_id AND version = OLD.version AND status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'sections of a non-draft version are frozen');
END;

-- Append-only logs.
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

-- job_id is left out so ON DELETE SET NULL still works.
CREATE TRIGGER messages_no_update BEFORE UPDATE OF
  project_id, thread, author, kind, content, created_at
ON messages
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;

CREATE TRIGGER messages_no_delete BEFORE DELETE ON messages
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;

CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions
BEGIN SELECT RAISE(ABORT, 'decisions are append-only; insert a superseding decision'); END;

CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'decisions are append-only'); END;

-- project_id and job_id are left out so ON DELETE SET NULL still works.
CREATE TRIGGER llm_calls_no_update BEFORE UPDATE OF
  agent, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at
ON llm_calls
BEGIN SELECT RAISE(ABORT, 'llm_calls are append-only'); END;
