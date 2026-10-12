// Migration test for 0002_messages_review_kind.sql.
// Run: node --test db/   (needs better-sqlite3)
//
// apply() follows the runner's steps from TRD §7: foreign_keys OFF outside the
// transaction, the file in one transaction, foreign_key_check before commit,
// foreign_keys back ON. Once the runner can be imported without the app, swap
// apply() for it so the runner itself is under test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'

const sql = name => readFileSync( new URL( `./${ name }`, import.meta.url ), 'utf8' )
const M0001 = sql( '0001_init.sql' )
const M0002 = sql( '0002_messages_review_kind.sql' )

function apply( db, migration ) {
  db.pragma( 'foreign_keys = OFF' )
  try {
    db.exec( 'BEGIN IMMEDIATE' )
    try {
      db.exec( migration )
      const orphans = db.pragma( 'foreign_key_check' )
      if ( orphans.length ) throw new Error( `foreign_key_check: ${ JSON.stringify( orphans ) }` )
      db.exec( 'COMMIT' )
    } catch ( err ) {
      db.exec( 'ROLLBACK' )
      throw err
    }
  } finally {
    db.pragma( 'foreign_keys = ON' )
  }
}

function at0001() {
  const db = new Database( ':memory:' )
  db.pragma( 'foreign_keys = ON' )
  apply( db, M0001 )
  return db
}

function upgraded() {
  const db = at0001()
  seed( db )
  apply( db, M0002 )
  return db
}

const refused = ( fn, pattern ) => assert.throws( fn, pattern )
const count = ( db, table, where = '1' ) =>
  db.prepare( `SELECT count(*) AS n FROM ${ table } WHERE ${ where }` ).get().n
const seq = db => db.prepare( `SELECT seq FROM sqlite_sequence WHERE name = 'messages'` ).get()?.seq

// Every kind 0001 allows, a job link, and a deleted project whose messages
// held the highest ids, so the AUTOINCREMENT mark is above max(id).
function seed( db ) {
  db.transaction( () => {
    const project = db.prepare( `INSERT INTO projects (id, name, current_state) VALUES (?, ?, ?)` )
    project.run( 'p1', 'Kept', 'GATE_PRD' )
    project.run( 'p2', 'Deleted', 'DISCOVERY' )
    db.prepare( `INSERT INTO jobs (project_id, kind, agent) VALUES ('p1', 'pm_draft_prd', 'pm')` ).run()

    const msg = db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content, job_id, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?)` )
    msg.run( 'p1', 'pm', 'human', 'chat', 'hello', null, 1 )
    msg.run( 'p1', 'pm', 'pm', 'chat', 'hi', 1, 2 )
    msg.run( 'p1', 'pm', 'human', 'discussion', 'why?', null, 3 )
    msg.run( 'p1', 'sa', 'sa', 'summary', 'loop done', null, 4 )
    msg.run( 'p1', 'sa', 'sa', 'system', 'note', null, 5 )
    msg.run( 'p2', 'pm', 'human', 'chat', 'gone', null, 6 )
    msg.run( 'p2', 'pm', 'pm', 'chat', 'gone too', null, 7 )
  } )()
  db.prepare( `DELETE FROM projects WHERE id = 'p2'` ).run()
}

// Everything in the schema except the messages table's own CREATE statement.
const schemaOutsideMessagesTable = db =>
  db.prepare( `SELECT type, name, tbl_name, sql FROM sqlite_master
                WHERE NOT (type = 'table' AND name = 'messages')
                ORDER BY type, name` ).all()

test( '0002 keeps every message, its id and the AUTOINCREMENT mark', () => {
  const db = at0001()
  seed( db )
  const before = db.prepare( `SELECT * FROM messages ORDER BY id` ).all()
  const mark = seq( db )
  assert.equal( mark, 7 )
  assert.equal( before.length, 5 )

  apply( db, M0002 )

  assert.deepEqual( db.prepare( `SELECT * FROM messages ORDER BY id` ).all(), before )
  assert.equal( seq( db ), mark )
  assert.equal( count( db, 'sqlite_sequence', `name = 'messages_new'` ), 0 )
  const next = db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content)
                            VALUES ('p1', 'pm', 'human', 'chat', 'next') RETURNING id` ).get()
  assert.equal( next.id, 8, 'ids of deleted messages are not reused' )
} )

test( '0002 works on an empty table with no AUTOINCREMENT row yet', () => {
  const db = at0001()
  apply( db, M0002 )
  assert.equal( seq( db ), undefined )
  db.prepare( `INSERT INTO projects (id, name, current_state) VALUES ('p1', 'X', 'DISCOVERY')` ).run()
  const row = db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content)
                           VALUES ('p1', 'pm', 'human', 'chat', 'hi') RETURNING id` ).get()
  assert.equal( row.id, 1 )
} )

test( '0002 changes nothing in the schema outside the messages table', () => {
  const db = at0001()
  seed( db )
  const before = schemaOutsideMessagesTable( db )
  const triggers = before.filter( r => r.tbl_name === 'messages' ).map( r => r.name )
  assert.deepEqual( triggers, [ 'messages_thread', 'messages_discussion_state', 'messages_no_delete', 'messages_no_update' ] )

  apply( db, M0002 )

  assert.deepEqual( schemaOutsideMessagesTable( db ), before, 'index and triggers re-created verbatim' )
} )

test( '0002 keeps the messages columns, keys and foreign keys', () => {
  const db = at0001()
  const shape = d => ( {
    columns: d.pragma( 'table_info(messages)' ),
    foreignKeys: d.pragma( 'foreign_key_list(messages)' ),
    indexes: d.pragma( 'index_list(messages)' ),
  } )
  const before = shape( db )
  apply( db, M0002 )
  assert.deepEqual( shape( db ), before )
} )

test( 'foreign_key_check and integrity_check pass after the upgrade', () => {
  const db = upgraded()
  assert.deepEqual( db.pragma( 'foreign_key_check' ), [] )
  assert.equal( db.pragma( 'integrity_check', { simple: true } ), 'ok' )
  assert.equal( db.pragma( 'foreign_keys', { simple: true } ), 1, 'foreign keys are back on' )
} )

test( 'a review message is accepted from the SA in the SA thread only', () => {
  const db = upgraded()
  const msg = db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content) VALUES ('p1', ?, ?, ?, 'notes')` )
  msg.run( 'sa', 'sa', 'review' )
  refused( () => msg.run( 'sa', 'pm', 'review' ), /CHECK/ )
  refused( () => msg.run( 'sa', 'human', 'review' ), /CHECK/ )
  refused( () => msg.run( 'pm', 'sa', 'review' ), /CHECK/ )
  refused( () => msg.run( 'sa', 'sa', 'critique' ), /CHECK/ )
  for ( const kind of [ 'chat', 'summary', 'system' ] ) msg.run( 'pm', 'pm', kind )
  refused( () => msg.run( 'human', 'pm', 'chat' ), /CHECK/ ) // thread <> 'human' survived the rebuild
} )

test( 'review messages are append-only like every other message', () => {
  const db = upgraded()
  const { id } = db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content)
                              VALUES ('p1', 'sa', 'sa', 'review', 'notes') RETURNING id` ).get()
  refused( () => db.prepare( `UPDATE messages SET content = 'x' WHERE id = ?` ).run( id ), /append-only/ )
  refused( () => db.prepare( `UPDATE messages SET kind = 'chat' WHERE id = ?` ).run( id ), /append-only/ )
  refused( () => db.prepare( `DELETE FROM messages WHERE id = ?` ).run( id ), /append-only/ )
} )

test( 'the re-created triggers still fire after the upgrade', () => {
  const db = upgraded()
  const talk = db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content)
                            VALUES ('p1', 'pm', ?, 'discussion', 'hi')` )
  talk.run( 'human' ) // p1 is at GATE_PRD
  db.prepare( `UPDATE projects SET current_state = 'PRD_DRAFT' WHERE id = 'p1'` ).run()
  refused( () => talk.run( 'human' ), /only allowed at a gate/ )
  talk.run( 'pm' ) // a reply in flight still lands
  refused( () => db.prepare( `UPDATE messages SET content = 'x' WHERE id = 1` ).run(), /append-only/ )
  refused( () => db.prepare( `DELETE FROM messages WHERE id = 1` ).run(), /append-only/ )
  const plan = db.prepare( `EXPLAIN QUERY PLAN SELECT * FROM messages WHERE project_id = ? AND thread = ? ORDER BY id` )
    .all( 'p1', 'sa' ).map( r => r.detail ).join( ' ' )
  assert.match( plan, /messages_thread/ )
} )

test( 'foreign key actions on messages still work after the upgrade', () => {
  const db = upgraded()
  db.prepare( `DELETE FROM jobs WHERE id = 1` ).run()
  assert.equal( count( db, 'messages', 'job_id IS NOT NULL' ), 0, 'ON DELETE SET NULL' )
  refused( () => db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content)
                              VALUES ('nope', 'pm', 'pm', 'chat', 'x')` ).run(), /FOREIGN KEY/ )
  db.prepare( `INSERT INTO messages (project_id, thread, author, kind, content)
               VALUES ('p1', 'sa', 'sa', 'review', 'notes')` ).run()
  db.prepare( `DELETE FROM projects WHERE id = 'p1'` ).run()
  assert.equal( count( db, 'messages' ), 0, 'project delete cascades through review messages' )
  assert.deepEqual( db.pragma( 'foreign_key_check' ), [] )
} )

test( 'a fresh install and an upgraded database end with the same schema', () => {
  const fresh = at0001()
  apply( fresh, M0002 )
  const all = d => d.prepare( `SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name` ).all()
  assert.deepEqual( all( upgraded() ), all( fresh ) )
} )

test( 'a failure inside 0002 rolls back and leaves 0001 intact', () => {
  const db = at0001()
  seed( db )
  const before = db.prepare( `SELECT type, name, sql FROM sqlite_master ORDER BY type, name` ).all()
  const broken = M0002.replace( 'DROP TABLE messages;', 'DROP TABLE messages; SELECT no_such_function();' )
  assert.throws( () => apply( db, broken ), /no_such_function/ )
  assert.deepEqual( db.prepare( `SELECT type, name, sql FROM sqlite_master ORDER BY type, name` ).all(), before )
  assert.equal( count( db, 'messages' ), 5 )
  assert.equal( db.pragma( 'foreign_keys', { simple: true } ), 1 )
} )
