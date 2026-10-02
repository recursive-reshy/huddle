// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import type { EventRow } from '#src/db/schema.js'
// Errors
import { NotFoundError } from '#src/errors.js'
// Services
import { createProject, getProject, listAllProjects } from './projects.service.js'
// Test support
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

let temp: TempDatabase
let bus: Bus
let published: EventRow[]

beforeEach( () => {
  temp = createTempDatabase()
  bus = createBus()
  published = []
  bus.subscribe( ( event ) => {
    if( 'id' in event ) {
      published.push( event )
    }
  } )
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'createProject', () => {
  it( 'creates a DISCOVERY project with a ULID id', () => {
    const project = createProject( temp.db, bus, { name: 'Huddle' } )

    expect( project ).toEqual( { id: expect.stringMatching( /^[0-9A-HJKMNP-TV-Z]{26}$/ ), name: 'Huddle', current_state: 'DISCOVERY', state_rev: 0, latest_event_id: 0 } )
    expect( getProject( temp.db, project.id ) ).toEqual( project )
  } )

  it( 'gives every project its own id and emits no event', () => {
    const first = createProject( temp.db, bus, { name: 'One' } )
    const second = createProject( temp.db, bus, { name: 'One' } )

    expect( first.id ).not.toBe( second.id )
    expect( published ).toEqual( [] )
  } )
} )

describe( 'listAllProjects', () => {
  it( 'is empty at first', () => {
    expect( listAllProjects( temp.db ) ).toEqual( [] )
  } )

  it( 'lists the newest project first even when two are created in the same millisecond', () => {
    const ids = [ 'one', 'two', 'three', 'four', 'five' ].map( ( name ) => createProject( temp.db, bus, { name } ).id )

    expect( listAllProjects( temp.db ).map( ( project ) => project.id ) ).toEqual( ids.toReversed() )
  } )
} )

describe( 'getProject', () => {
  it( 'throws NotFoundError for an unknown id', () => {
    expect( () => getProject( temp.db, 'nope' ) ).toThrow( NotFoundError )
  } )
} )
