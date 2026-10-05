// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Bus
import { createBus } from '#src/bus/bus.js'
// DB
import { messages } from '#src/db/schema.js'
import { writeTransaction } from '#src/db/transaction.js'
// Repositories
import { insertMessage, listRecentMessages, listThreadMessages } from './messages.repository.js'
// Test support
import { insertJob, insertProject } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

let temp: TempDatabase

beforeEach( () => {
  temp = createTempDatabase()
  insertProject( temp.db, 'p1' )
  insertProject( temp.db, 'p2' )
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'insertMessage', () => {
  it( 'stores the message and returns the wire shape without job_id', () => {
    const message = writeTransaction( temp.db, createBus(), ( tx ) => insertMessage( tx, { project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: 'Hi' } ) )

    expect( message ).toEqual( { id: 1, project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: 'Hi', created_at: expect.any( Number ) } )
    expect( Object.keys( message ) ).not.toContain( 'job_id' )
  } )

  it( 'stores the job_id it is given and leaves it NULL otherwise', () => {
    const job = insertJob( temp.db )

    writeTransaction( temp.db, createBus(), ( tx ) => {
      insertMessage( tx, { project_id: 'p1', thread: 'pm', author: 'pm', kind: 'chat', content: 'Reply', job_id: job.id } )
      insertMessage( tx, { project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: 'Hi' } )
    } )

    const rows = temp.db.$client.prepare( 'SELECT job_id FROM messages ORDER BY id' ).all()

    expect( rows ).toEqual( [ { job_id: job.id }, { job_id: null } ] )
  } )
} )

describe( 'listRecentMessages', () => {
  function seed( count: number, overrides: Partial< typeof messages.$inferInsert > = {} ): void {
    for( let index = 1; index <= count; index++ ) {
      temp.db.insert( messages ).values( { project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: `m${ index }`, ...overrides } ).run()
    }
  }

  function contents( limit: number, up_to_id = 1_000 ): string[] {
    return listRecentMessages( temp.db, { project_id: 'p1', thread: 'pm', kind: 'chat', up_to_id, limit } ).map( ( message ) => message.content )
  }

  it( 'returns the last `limit` messages, oldest first', () => {
    seed( 5 )

    expect( contents( 3 ) ).toEqual( [ 'm3', 'm4', 'm5' ] )
  } )

  it( 'returns everything when there are fewer than the limit', () => {
    seed( 2 )

    expect( contents( 20 ) ).toEqual( [ 'm1', 'm2' ] )
  } )

  it( 'ends at up_to_id, inclusive, and leaves later messages out', () => {
    seed( 5 )

    expect( contents( 20, 3 ) ).toEqual( [ 'm1', 'm2', 'm3' ] )
    expect( contents( 2, 4 ) ).toEqual( [ 'm3', 'm4' ] )
  } )

  it( 'returns only the kind asked for, in that project and thread', () => {
    temp.db.insert( messages ).values( [
      { project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: 'chat 1' },
      { project_id: 'p1', thread: 'pm', author: 'pm', kind: 'discussion', content: 'discussion' },
      { project_id: 'p1', thread: 'pm', author: 'sa', kind: 'system', content: 'system' },
      { project_id: 'p1', thread: 'pm', author: 'sa', kind: 'summary', content: 'summary' },
      { project_id: 'p1', thread: 'sa', author: 'human', kind: 'chat', content: 'other thread' },
      { project_id: 'p2', thread: 'pm', author: 'human', kind: 'chat', content: 'other project' },
      { project_id: 'p1', thread: 'pm', author: 'pm', kind: 'chat', content: 'chat 2' },
    ] ).run()

    expect( contents( 20 ) ).toEqual( [ 'chat 1', 'chat 2' ] )
  } )

  it( 'counts the limit over matching messages only, so other kinds never push chat out of the window', () => {
    seed( 2 )
    seed( 5, { kind: 'discussion', author: 'pm' } )

    expect( contents( 2 ) ).toEqual( [ 'm1', 'm2' ] )
  } )
} )

describe( 'listThreadMessages', () => {
  it( 'returns only that project and thread, oldest first, whatever the kind', () => {
    temp.db.insert( messages ).values( [
      { project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: 'first' },
      { project_id: 'p1', thread: 'sa', author: 'human', kind: 'chat', content: 'other thread' },
      { project_id: 'p2', thread: 'pm', author: 'human', kind: 'chat', content: 'other project' },
      { project_id: 'p1', thread: 'pm', author: 'pm', kind: 'chat', content: 'second' },
      { project_id: 'p1', thread: 'pm', author: 'sa', kind: 'summary', content: 'third' },
    ] ).run()

    const thread = listThreadMessages( temp.db, { project_id: 'p1', thread: 'pm' } )

    expect( thread.map( ( message ) => message.content ) ).toEqual( [ 'first', 'second', 'third' ] )
    expect( thread[ 0 ] ).toEqual( { id: 1, project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: 'first', created_at: expect.any( Number ) } )
  } )

  it( 'is empty for a thread with no messages', () => {
    expect( listThreadMessages( temp.db, { project_id: 'p1', thread: 'sa' } ) ).toEqual( [] )
  } )
} )
