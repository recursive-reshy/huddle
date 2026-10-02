// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Shared
import { errorResponse, projectEnvelope, projectsEnvelope } from '@my-team/shared'
// App
import { createApp } from '#src/app.js'
// Bus
import { createBus } from '#src/bus/bus.js'
// Test support
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'
import { startTestApp, type TestApp } from '#src/test-support/test-app.js'

let temp: TempDatabase
let app: TestApp

beforeEach( async () => {
  temp = createTempDatabase()
  app = await startTestApp( createApp( { db: temp.db, bus: createBus() } ) )
} )

afterEach( async () => {
  await app.close()
  temp.cleanup()
} )

describe( 'POST /api/projects', () => {
  it( 'creates a DISCOVERY project and answers 201 { project }', async () => {
    const { status, body } = await app.request( '/api/projects', { method: 'POST', body: { name: 'Huddle' } } )

    expect( status ).toBe( 201 )
    expect( projectEnvelope.parse( body ).project ).toMatchObject( { name: 'Huddle', current_state: 'DISCOVERY', state_rev: 0, latest_event_id: 0 } )
  } )

  it( 'can be read back with GET /api/projects/:id', async () => {
    const created = projectEnvelope.parse( ( await app.request( '/api/projects', { method: 'POST', body: { name: 'Huddle' } } ) ).body )

    const { status, body } = await app.request( `/api/projects/${ created.project.id }` )

    expect( status ).toBe( 200 )
    expect( body ).toEqual( created )
  } )

  it.each( [
    [ 'an empty name', { name: '' } ],
    [ 'a missing name', {} ],
    [ 'a name that is not a string', { name: 7 } ],
    [ 'an undeclared field', { name: 'Huddle', current_state: 'DONE' } ],
  ] )( 'answers 400 { error: Bad Request, issues } for %s', async ( _label, payload ) => {
    const { status, body } = await app.request( '/api/projects', { method: 'POST', body: payload } )

    expect( status ).toBe( 400 )
    expect( body ).toEqual( { error: 'Bad Request', issues: expect.arrayContaining( [ expect.objectContaining( { message: expect.any( String ) } ) ] ) } )
  } )

  it( 'answers 400 when there is no body at all', async () => {
    const { status, body } = await app.request( '/api/projects', { method: 'POST' } )

    expect( status ).toBe( 400 )
    expect( body ).toMatchObject( { error: 'Bad Request' } )
  } )

  it( 'answers 400 for a body that is not JSON', async () => {
    const { status, body } = await app.request( '/api/projects', { method: 'POST', rawBody: '{ nope' } )

    expect( status ).toBe( 400 )
    expect( body ).toMatchObject( { error: 'Bad Request' } )
  } )

  it( 'creates nothing when the body is invalid', async () => {
    await app.request( '/api/projects', { method: 'POST', body: { name: '' } } )

    expect( projectsEnvelope.parse( ( await app.request( '/api/projects' ) ).body ).projects ).toEqual( [] )
  } )
} )

describe( 'GET /api/projects', () => {
  it( 'answers 200 { projects: [] } when there are none', async () => {
    const { status, body } = await app.request( '/api/projects' )

    expect( status ).toBe( 200 )
    expect( body ).toEqual( { projects: [] } )
  } )

  it( 'lists the projects newest first', async () => {
    for( const name of [ 'one', 'two', 'three' ] ) {
      await app.request( '/api/projects', { method: 'POST', body: { name } } )
    }

    const { body } = await app.request( '/api/projects' )

    expect( projectsEnvelope.parse( body ).projects.map( ( project ) => project.name ) ).toEqual( [ 'three', 'two', 'one' ] )
  } )
} )

describe( 'GET /api/projects/:projectId', () => {
  it( 'answers 404 { error } for an unknown project', async () => {
    const { status, body } = await app.request( '/api/projects/nope' )

    expect( status ).toBe( 404 )
    expect( errorResponse.parse( body ).error ).toEqual( expect.any( String ) )
  } )
} )
