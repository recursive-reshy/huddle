// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// DB
import { projects } from '#src/db/schema.js'
// Repositories
import { appendEvent } from './events.repository.js'
// Test support
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

let temp: TempDatabase

beforeEach( () => {
  temp = createTempDatabase()
  temp.db.insert( projects ).values( { id: 'p1', name: 'One', current_state: 'DISCOVERY' } ).run()
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'appendEvent', () => {
  it( 'inserts the event and returns the stored row', () => {
    const event = appendEvent( temp.db, { project_id: 'p1', type: 'JobClaimed', actor: 'pm', payload: { job_id: 7, attempt: 1 } } )

    expect( event.id ).toBeGreaterThan( 0 )
    expect( event ).toMatchObject( { project_id: 'p1', type: 'JobClaimed', actor: 'pm', payload: { job_id: 7, attempt: 1 } } )
    expect( event.created_at ).toBeGreaterThan( 0 )

    const stored = temp.db.$client.prepare( 'SELECT type, actor, payload FROM events WHERE id = ?' ).get( event.id )

    expect( stored ).toEqual( { type: 'JobClaimed', actor: 'pm', payload: '{"job_id":7,"attempt":1}' } )
  } )

  it( 'stores a null actor for system events', () => {
    const event = appendEvent( temp.db, { project_id: 'p1', type: 'JobFailed', payload: {} } )

    expect( event.actor ).toBeNull()
  } )

  it( 'gives increasing ids', () => {
    const first = appendEvent( temp.db, { project_id: 'p1', type: 'JobClaimed', payload: {} } )
    const second = appendEvent( temp.db, { project_id: 'p1', type: 'JobClaimed', payload: {} } )

    expect( second.id ).toBeGreaterThan( first.id )
  } )

  it( 'lets the database reject a payload missing its required fields', () => {
    expect( () => appendEvent( temp.db, { project_id: 'p1', type: 'StateTransitioned', payload: { from: 'DISCOVERY' } } ) ).toThrow( /payload/ )
  } )
} )
