// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Bus
import { createBus } from '#src/bus/bus.js'
// DB
import { projects } from '#src/db/schema.js'
import { writeTransaction } from '#src/db/transaction.js'
// Repositories
import { appendEvent } from './events.repository.js'
import { findProject, insertProject, listProjects } from './projects.repository.js'
// Test support
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

let temp: TempDatabase

beforeEach( () => {
  temp = createTempDatabase()
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'insertProject', () => {
  it( 'stores a DISCOVERY project at state_rev 0 and returns it with latest_event_id 0', () => {
    const project = writeTransaction( temp.db, createBus(), ( tx ) => insertProject( tx, { id: 'p1', name: 'Huddle' } ) )

    expect( project ).toEqual( { id: 'p1', name: 'Huddle', current_state: 'DISCOVERY', state_rev: 0, latest_event_id: 0 } )
  } )
} )

describe( 'findProject', () => {
  it( 'returns undefined for an unknown id', () => {
    expect( findProject( temp.db, 'nope' ) ).toBeUndefined()
  } )

  it( 'reports the newest event of that project only', () => {
    temp.db.insert( projects ).values( [
      { id: 'p1', name: 'One', current_state: 'DISCOVERY' },
      { id: 'p2', name: 'Two', current_state: 'DISCOVERY' },
    ] ).run()
    writeTransaction( temp.db, createBus(), ( tx ) => {
      appendEvent( tx, { project_id: 'p1', type: 'JobClaimed', payload: { job_id: 1, attempt: 1 } } )
      const newest = appendEvent( tx, { project_id: 'p1', type: 'JobClaimed', payload: { job_id: 1, attempt: 2 } } )
      appendEvent( tx, { project_id: 'p2', type: 'JobClaimed', payload: { job_id: 2, attempt: 1 } } )

      return newest
    } )

    expect( findProject( temp.db, 'p1' ) ).toMatchObject( { id: 'p1', latest_event_id: 2 } )
    expect( findProject( temp.db, 'p2' ) ).toMatchObject( { id: 'p2', latest_event_id: 3 } )
  } )
} )

describe( 'listProjects', () => {
  it( 'is empty when there are no projects', () => {
    expect( listProjects( temp.db ) ).toEqual( [] )
  } )

  it( 'lists newest first by created_at, then by id', () => {
    temp.db.insert( projects ).values( [
      { id: 'a', name: 'oldest', current_state: 'DISCOVERY', created_at: 100 },
      { id: 'b', name: 'tie, lower id', current_state: 'DISCOVERY', created_at: 200 },
      { id: 'c', name: 'tie, higher id', current_state: 'DISCOVERY', created_at: 200 },
      { id: 'd', name: 'newest', current_state: 'DISCOVERY', created_at: 300 },
    ] ).run()

    expect( listProjects( temp.db ).map( ( project ) => project.id ) ).toEqual( [ 'd', 'c', 'b', 'a' ] )
  } )

  it( 'carries latest_event_id for each project', () => {
    temp.db.insert( projects ).values( [
      { id: 'p1', name: 'One', current_state: 'DISCOVERY', created_at: 1 },
      { id: 'p2', name: 'Two', current_state: 'DISCOVERY', created_at: 2 },
    ] ).run()
    writeTransaction( temp.db, createBus(), ( tx ) => appendEvent( tx, { project_id: 'p1', type: 'JobClaimed', payload: { job_id: 1, attempt: 1 } } ) )

    expect( listProjects( temp.db ).map( ( project ) => [ project.id, project.latest_event_id ] ) ).toEqual( [ [ 'p2', 0 ], [ 'p1', 1 ] ] )
  } )
} )
