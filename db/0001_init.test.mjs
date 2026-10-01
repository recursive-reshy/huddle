// Migration test for 0001_init.sql.
// Run: node --test 0001_init.test.mjs   (needs better-sqlite3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const MIGRATION = readFileSync(new URL('./0001_init.sql', import.meta.url), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATION);
  return db;
}

const PROJECT_TABLES = [
  'artifacts', 'artifact_versions', 'artifact_sections', 'jobs', 'messages',
  'events', 'clarifications', 'decisions',
];

const count = (db, table, where = '1') =>
  db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get().n;

const refused = (fn, pattern) => assert.throws(fn, pattern);

// One project with every kind of row: v1 superseded, v2 approved,
// v3 discarded (sent back), v4 draft whose parent is v3.
function seed(db) {
  db.transaction(() => {
    db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'Demo', 'TRD_DRAFT')`).run();
    db.prepare(`INSERT INTO artifacts (id, project_id, kind) VALUES ('a1', 'p1', 'trd')`).run();

    const addVersion = db.prepare(
      `INSERT INTO artifact_versions (artifact_id, version, parent_version, created_by) VALUES ('a1', ?, ?, 'sa')`);
    const addSection = db.prepare(
      `INSERT INTO artifact_sections VALUES ('a1', ?, 'data', 1, 'Data', ?, 'dba')`);
    const setStatus = db.prepare(
      `UPDATE artifact_versions SET status = ?, approved_at = ? WHERE artifact_id = 'a1' AND version = ?`);

    addVersion.run(1, null); addSection.run(1, 'v1'); setStatus.run('approved', 1000, 1);
    addVersion.run(2, 1);    addSection.run(2, 'v2');
    setStatus.run('superseded', 1000, 1); setStatus.run('approved', 2000, 2);
    addVersion.run(3, 2);    addSection.run(3, 'v3'); setStatus.run('discarded', null, 3);
    addVersion.run(4, 3);    addSection.run(4, 'v4 after send-back');

    db.prepare(`INSERT INTO jobs (project_id, kind, agent) VALUES ('p1', 'sa_draft_trd', 'sa')`).run();
    db.prepare(`INSERT INTO messages (project_id, thread, author, kind, content, job_id)
                VALUES ('p1', 'sa', 'sa', 'chat', 'TRD drafted', 1)`).run();
    db.prepare(`INSERT INTO llm_calls (project_id, job_id, agent, model, input_tokens, output_tokens, cost_micro_usd)
                VALUES ('p1', 1, 'sa', 'model-x', 1000, 200, 6000)`).run();

    const ev = db.prepare(`INSERT INTO events (project_id, type, actor, payload) VALUES ('p1', ?, ?, ?)`);
    ev.run('StateTransitioned', 'human', JSON.stringify({ from: 'GATE_PRD', to: 'TRD_DRAFT', trigger: 'approve', state_rev: 1 }));
    ev.run('MessageCompleted', 'sa', JSON.stringify({ message_id: 1 }));
    ev.run('GateSentBack', 'human', JSON.stringify({ notes: 'Add backup section' }));

    const cl = db.prepare(`INSERT INTO clarifications
      (id, project_id, thread_id, round, from_agent, to_agent, question, status, answer, answered_by, answered_at, artifact_id, artifact_version)
      VALUES (?, 'p1', 't1', ?, 'sa', 'pm', 'Q', ?, ?, ?, ?, 'a1', 2)`);
    cl.run('c1', 1, 'answered', 'A', 'pm', 5);
    cl.run('c2', 2, 'deferred', 'Assume weekly use', 'pm', 6);
    cl.run('c3', 3, 'open', null, null, null);

    db.prepare(`INSERT INTO decisions (id, project_id, title, decision, rationale, decided_by, artifact_id, artifact_version)
                VALUES ('d1', 'p1', 'DB', 'SQLite', 'single user', 'human', 'a1', 2)`).run();
    db.prepare(`INSERT INTO decisions (id, project_id, title, decision, rationale, decided_by, supersedes)
                VALUES ('d2', 'p1', 'DB', 'SQLite + WAL', 'concurrency', 'human', 'd1')`).run();
  })();
}

test('deleting a project cascades through frozen and append-only rows', () => {
  const db = freshDb();
  seed(db);
  for (const t of PROJECT_TABLES) assert.ok(count(db, t) > 0, `${t} seeded`);

  db.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();

  for (const t of PROJECT_TABLES) assert.equal(count(db, t), 0, `${t} emptied`);
  assert.equal(count(db, 'llm_calls', 'project_id IS NULL AND job_id IS NULL'), 1, 'cost history kept');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('direct deletes of frozen or append-only rows are refused', () => {
  const db = freshDb();
  seed(db);
  for (const v of [1, 2, 3]) {
    refused(() => db.prepare(`DELETE FROM artifact_versions WHERE artifact_id = 'a1' AND version = ?`).run(v), /non-draft version/);
  }
  refused(() => db.prepare(`DELETE FROM artifact_sections WHERE version = 2`).run(), /frozen/);
  refused(() => db.prepare(`DELETE FROM events WHERE id = 1`).run(), /append-only/);
  refused(() => db.prepare(`DELETE FROM messages WHERE id = 1`).run(), /append-only/);
  refused(() => db.prepare(`DELETE FROM decisions WHERE id = 'd1'`).run(), /append-only/);
  // A draft can still be deleted, with its sections.
  db.prepare(`DELETE FROM artifact_versions WHERE artifact_id = 'a1' AND version = 4`).run();
  assert.equal(count(db, 'artifact_sections', 'version = 4'), 0);
});

test('only the three allowed version transitions pass', () => {
  const db = freshDb();
  seed(db);
  const set = (v, status, at) =>
    db.prepare(`UPDATE artifact_versions SET status = ?, approved_at = ? WHERE artifact_id = 'a1' AND version = ?`).run(status, at, v);

  refused(() => set(2, 'draft', null), /./);        // approved -> draft
  refused(() => set(2, 'discarded', null), /./);    // approved -> discarded
  refused(() => set(1, 'approved', 1000), /./);     // superseded -> approved
  refused(() => set(3, 'draft', null), /./);        // discarded -> draft
  refused(() => set(4, 'superseded', 9), /./);      // draft -> superseded
  refused(() => set(4, 'draft', 9), /CHECK/);       // draft carrying approved_at
  refused(() => db.prepare(`UPDATE artifact_sections SET content = 'x' WHERE version = 3`).run(), /frozen/);

  db.prepare(`UPDATE artifact_sections SET content = 'edited' WHERE version = 4`).run(); // draft editable
  db.transaction(() => { set(2, 'superseded', 2000); set(4, 'approved', 3000); })();
  assert.equal(db.prepare(`SELECT status FROM artifact_versions WHERE version = 4`).get().status, 'approved');
});

test('approval must supersede the old version before approving the new one', () => {
  const db = freshDb();
  seed(db);
  refused(() => db.prepare(`UPDATE artifact_versions SET status = 'approved', approved_at = 3000 WHERE version = 4`).run(),
    /UNIQUE/);
});

test('an edit or send-back discards the draft before the new draft is created', () => {
  const db = freshDb();
  seed(db);
  const newDraft = db.prepare(
    `INSERT INTO artifact_versions (artifact_id, version, parent_version, created_by) VALUES ('a1', 5, 4, 'human')`);
  refused(() => newDraft.run(), /UNIQUE/); // v4 is still the open draft
  db.transaction(() => {
    db.prepare(`UPDATE artifact_versions SET status = 'discarded' WHERE version = 4`).run();
    newDraft.run();
  })();
  assert.equal(db.prepare(`SELECT parent_version FROM artifact_versions WHERE version = 5`).get().parent_version, 4);
});

test('workflow states, job kinds and job agents are constrained', () => {
  const db = freshDb();
  refused(() => db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('x', 'X', 'NOPE')`).run(), /CHECK/);
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'DISCOVERY')`).run();
  const job = db.prepare(`INSERT INTO jobs (project_id, kind, agent) VALUES ('p1', ?, ?)`);
  refused(() => job.run('deploy', 'sa'), /CHECK/);
  refused(() => job.run('pm_draft_prd', 'sa'), /CHECK/);
  refused(() => job.run('loop_summary', 'pm'), /CHECK/);
  job.run('clarification_round', 'pm');
  job.run('clarification_round', 'sa');
  job.run('revise_artifact', 'sa');
});

test('leaving ESCALATED finds the state it came from', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'ESCALATED')`).run();
  db.prepare(`INSERT INTO events (project_id, type, payload) VALUES ('p1', 'StateTransitioned', ?)`)
    .run(JSON.stringify({ from: 'SA_REVIEW', to: 'ESCALATED', trigger: 'loop_limit', state_rev: 4 }));
  const row = db.prepare(`
    SELECT json_extract(payload, '$.from') AS back_to FROM events
     WHERE project_id = 'p1' AND type = 'StateTransitioned' AND json_extract(payload, '$.to') = 'ESCALATED'
     ORDER BY id DESC LIMIT 1`).get();
  assert.equal(row.back_to, 'SA_REVIEW');
});

test('clarification outcomes and the loop stop rule', () => {
  const db = freshDb();
  seed(db);
  refused(() => db.prepare(`UPDATE clarifications SET status = 'deferred' WHERE id = 'c3'`).run(), /CHECK/);
  db.prepare(`UPDATE clarifications SET status = 'deferred', answer = 'Assume SG only', answered_by = 'pm', answered_at = 9
              WHERE id = 'c3'`).run();
  assert.equal(count(db, 'clarifications', `thread_id = 't1' AND status = 'open'`), 0);
});

test('event payloads carry the fields other code depends on', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'DISCOVERY')`).run();
  const ev = db.prepare(`INSERT INTO events (project_id, type, payload) VALUES ('p1', ?, ?)`);
  refused(() => ev.run('StateTransitioned', '{"from":"DISCOVERY"}'), /payload/);
  refused(() => ev.run('MessageCompleted', '{"text":"hi"}'), /payload/);
  refused(() => ev.run('GateSentBack', '{}'), /payload/);
  refused(() => ev.run('Bogus', '{}'), /CHECK/);
});

test('messages are append-only but a deleted job clears job_id', () => {
  const db = freshDb();
  seed(db);
  refused(() => db.prepare(`UPDATE messages SET content = 'x'`).run(), /append-only/);
  db.prepare(`DELETE FROM jobs WHERE id = 1`).run();
  assert.equal(count(db, 'messages', 'job_id IS NULL'), 1);
  assert.equal(count(db, 'llm_calls', 'job_id IS NULL'), 1);
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM messages WHERE project_id = ? AND thread = ? ORDER BY id`)
    .all('p1', 'sa').map(r => r.detail).join(' ');
  assert.match(plan, /messages_thread/);
});

test('state_rev lock and fenced job writes reject stale writers', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'DISCOVERY')`).run();
  const move = db.prepare(`UPDATE projects SET current_state = ?, state_rev = state_rev + 1, updated_at = 1
                            WHERE id = 'p1' AND state_rev = ?`);
  assert.equal(move.run('BRIEF_DRAFT', 0).changes, 1);
  assert.equal(move.run('GATE_BRIEF', 0).changes, 0);

  db.prepare(`INSERT INTO jobs (project_id, kind, agent, run_after) VALUES ('p1', 'pm_draft_brief', 'pm', 0)`).run();
  const claim = db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = ?, lease_expires_at = ?
                             WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY run_after, id LIMIT 1)
                             RETURNING id, attempts`);
  const first = claim.get(10, 20, 10);
  db.prepare(`UPDATE jobs SET status = 'queued', lease_expires_at = NULL WHERE id = ?`).run(first.id); // lease expired
  const second = claim.get(30, 40, 30);
  const finish = db.prepare(`UPDATE jobs SET status = 'succeeded', finished_at = ?, lease_expires_at = NULL
                              WHERE id = ? AND status = 'running' AND attempts = ?`);
  assert.equal(finish.run(50, first.id, first.attempts).changes, 0, 'stale worker rejected');
  assert.equal(finish.run(50, second.id, second.attempts).changes, 1);
});

test('message threads belong to agents, never to the human', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'DISCOVERY')`).run();
  const msg = db.prepare(`INSERT INTO messages (project_id, thread, author, kind, content) VALUES ('p1', ?, 'human', 'chat', 'hi')`);
  msg.run('pm');
  refused(() => msg.run('human'), /CHECK/);
  refused(() => msg.run('qa'), /FOREIGN KEY/);
  // A new role is an INSERT, not a migration.
  db.prepare(`INSERT INTO agents (id, name) VALUES ('qa', 'QA')`).run();
  msg.run('qa');
});

test('boot recovery re-queues orphaned jobs and fails exhausted ones', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'DISCOVERY')`).run();
  const running = db.prepare(`INSERT INTO jobs (project_id, kind, agent, status, attempts, locked_at, lease_expires_at)
                              VALUES ('p1', 'pm_draft_brief', 'pm', 'running', ?, 10, 999999999)`);
  running.run(1); // lease still "valid", but the process that held it is gone
  running.run(3); // max_attempts reached
  const now = 100;
  db.transaction(() => {
    const failed = db.prepare(`UPDATE jobs SET status = 'failed', error = 'orphaned at boot', finished_at = ?, lease_expires_at = NULL
                                WHERE status = 'running' AND attempts >= max_attempts RETURNING id, project_id`).all(now);
    for (const j of failed) {
      db.prepare(`INSERT INTO events (project_id, type, payload) VALUES (?, 'JobFailed', json_object('job_id', ?, 'reason', 'orphaned at boot'))`)
        .run(j.project_id, j.id);
    }
    db.prepare(`UPDATE jobs SET status = 'queued', lease_expires_at = NULL, locked_at = NULL, run_after = ?
                WHERE status = 'running'`).run(now);
  })();
  assert.deepEqual(db.prepare(`SELECT status FROM jobs ORDER BY id`).all().map(r => r.status), ['queued', 'failed']);
  assert.equal(count(db, 'events', `type = 'JobFailed'`), 1);
});

// --- rev 3: US-22 gate discussion -----------------------------------------

test('agent_chat_reply runs on pm or sa only', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'GATE_PRD')`).run();
  const job = db.prepare(`INSERT INTO jobs (project_id, kind, agent) VALUES ('p1', 'agent_chat_reply', ?)`);
  job.run('pm');
  job.run('sa');
  refused(() => job.run('dba'), /CHECK/);
  refused(() => job.run('human'), /CHECK/);
});

test('discussion messages are accepted and stay append-only', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'GATE_TRD')`).run();
  const msg = db.prepare(`INSERT INTO messages (project_id, thread, author, kind, content) VALUES ('p1', 'sa', ?, 'discussion', ?)`);
  msg.run('human', 'Why SQLite and not Postgres?');
  msg.run('sa', 'Single user, one process, zero cost.');
  refused(() => db.prepare(`INSERT INTO messages (project_id, thread, author, kind, content)
                            VALUES ('p1', 'sa', 'human', 'banter', 'x')`).run(), /CHECK/);
  refused(() => db.prepare(`UPDATE messages SET content = 'edited' WHERE id = 1`).run(), /append-only/);
  refused(() => db.prepare(`UPDATE messages SET kind = 'chat' WHERE id = 1`).run(), /append-only/);
  refused(() => db.prepare(`DELETE FROM messages WHERE id = 1`).run(), /append-only/);
});

test('Naresh can only open a discussion at a gate or while ESCALATED', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'GATE_BRIEF')`).run();
  const say = db.prepare(`INSERT INTO messages (project_id, thread, author, kind, content) VALUES ('p1', 'pm', ?, 'discussion', 'hi')`);
  const moveTo = s => db.prepare(`UPDATE projects SET current_state = ? WHERE id = 'p1'`).run(s);
  for (const s of ['GATE_BRIEF', 'GATE_PRD', 'GATE_TRD', 'ESCALATED']) { moveTo(s); say.run('human'); }
  for (const s of ['DISCOVERY', 'BRIEF_DRAFT', 'SA_REVIEW', 'PRD_DRAFT', 'TRD_DRAFT', 'DONE']) {
    moveTo(s);
    refused(() => say.run('human'), /only allowed at a gate/);
  }
  // A reply already in flight still lands after the gate is left.
  moveTo('PRD_DRAFT');
  say.run('pm');
  // Ordinary chat is not affected.
  moveTo('DISCOVERY');
  db.prepare(`INSERT INTO messages (project_id, thread, author, kind, content) VALUES ('p1', 'pm', 'human', 'chat', 'hi')`).run();
});
