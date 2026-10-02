// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Bus
import { createBus } from '#src/bus/bus.js'
// DB
import { messages } from '#src/db/schema.js'
import { writeTransaction } from '#src/db/transaction.js'
// Repositories
import { insertMessage, listThreadMessages } from './messages.repository.js'
// Test support
import { insertProject } from '#src/test-support/insert-job.js'
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
