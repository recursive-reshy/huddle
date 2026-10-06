// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Shared
import { messageEnvelope, projectEnvelope, threadEnvelope } from '@huddle/shared'
// App
import { createApp } from '#src/app.js'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import type { EventRow } from '#src/db/schema.js'
// Worker
import { createWorker } from '#src/worker/worker.js'
// Test support
import { readJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'
import { startTestApp, type TestApp } from '#src/test-support/test-app.js'

let temp: TempDatabase
let bus: Bus
let app: TestApp
let projectId: string

async function post( content: unknown, thread: unknown = 'pm', id = projectId ): Promise< Awaited< ReturnType< TestApp[ 'request' ] > > > {
  return app.request( `/api/projects/${ id }/messages`, { method: 'POST', body: { thread, content } } )
}

function rows< T >( sql: string ): T[] {
  return temp.db.$client.prepare( sql ).all() as T[]
}

beforeEach( async () => {
  temp = createTempDatabase()
  bus = createBus()
  app = await startTestApp( createApp( { db: temp.db, bus } ) )
  projectId = projectEnvelope.parse( ( await app.request( '/api/projects', { method: 'POST', body: { name: 'Huddle' } } ) ).body ).project.id
} )

afterEach( async () => {
  await app.close()
  temp.cleanup()
} )

describe( 'POST /api/projects/:projectId/messages', () => {
  it( 'answers 201 { message } with Naresh as the author', async () => {
    const { status, body } = await post( 'Build me a tracker' )

    expect( status ).toBe( 201 )
    expect( messageEnvelope.parse( body ).message ).toMatchObject( { project_id: projectId, thread: 'pm', author: 'human', kind: 'chat', content: 'Build me a tracker' } )
  } )

  it( 'stores MessageCompleted and one queued pm_discovery_reply carrying the message_id', async () => {
    const { message } = messageEnvelope.parse( ( await post( 'Hello' ) ).body )

    expect( rows< { type: string, actor: string } >( 'SELECT type, actor FROM events' ) ).toEqual( [ { type: 'MessageCompleted', actor: 'human' } ] )
    expect( rows< { id: number } >( 'SELECT id FROM jobs' ) ).toHaveLength( 1 )
    expect( readJob( temp.db, 1 ) ).toMatchObject( { kind: 'pm_discovery_reply', agent: 'pm', status: 'queued', input: { message_id: message.id } } )
  } )

  it( 'moves latest_event_id on the project', async () => {
    await post( 'Hello' )

    const { body } = await app.request( `/api/projects/${ projectId }` )

    expect( projectEnvelope.parse( body ).project.latest_event_id ).toBe( 1 )
  } )

  it.each( [
    [ 'the human as the thread', 'Hi', 'human' ],
    [ 'an unknown thread', 'Hi', 'dba' ],
    [ 'a null thread', 'Hi', null ],
    [ 'empty content', '', 'pm' ],
    [ 'content that is not a string', 5, 'pm' ],
    [ 'no content', undefined, 'pm' ],
  ] )( 'answers 400 { error: Bad Request, issues } for %s and writes nothing', async ( _label, content, thread ) => {
    const { status, body } = await post( content, thread )

    expect( status ).toBe( 400 )
    expect( body ).toEqual( { error: 'Bad Request', issues: expect.any( Array ) } )
    expect( rows( 'SELECT 1 FROM messages' ) ).toEqual( [] )
    expect( rows( 'SELECT 1 FROM jobs' ) ).toEqual( [] )
  } )

  it( 'answers 400 when the thread is left out', async () => {
    const { status } = await app.request( `/api/projects/${ projectId }/messages`, { method: 'POST', body: { content: 'Hi' } } )

    expect( status ).toBe( 400 )
  } )

  it( 'refuses a body that names its own author', async () => {
    const { status } = await app.request( `/api/projects/${ projectId }/messages`, { method: 'POST', body: { thread: 'pm', content: 'Hi', author: 'sa' } } )

    expect( status ).toBe( 400 )
  } )

  it( 'answers 404 { error } for an unknown project', async () => {
    const { status, body } = await post( 'Hi', 'pm', 'nope' )

    expect( status ).toBe( 404 )
    expect( body ).toEqual( { error: expect.any( String ) } )
  } )

  it( 'checks the body before the project: an invalid body for an unknown project is 400', async () => {
    const { status } = await post( '', 'pm', 'nope' )

    expect( status ).toBe( 400 )
  } )

  it( 'answers 409 { error } for the sa thread while in DISCOVERY', async () => {
    const { status, body } = await post( 'Hi', 'sa' )

    expect( status ).toBe( 409 )
    expect( body ).toEqual( { error: expect.any( String ) } )
    expect( rows( 'SELECT 1 FROM messages' ) ).toEqual( [] )
  } )

  it( 'answers 409 { error } outside DISCOVERY', async () => {
    temp.db.$client.prepare( "UPDATE projects SET current_state = 'GATE_BRIEF' WHERE id = ?" ).run( projectId )

    const { status, body } = await post( 'Hi' )

    expect( status ).toBe( 409 )
    expect( body ).toEqual( { error: expect.any( String ) } )
  } )

  it( 'answers 409 { error } for a second message while the reply is queued, and stores nothing', async () => {
    await post( 'First' )

    const { status, body } = await post( 'Second' )

    expect( status ).toBe( 409 )
    expect( body ).toEqual( { error: expect.any( String ) } )
    expect( rows( 'SELECT 1 FROM messages' ) ).toHaveLength( 1 )
    expect( rows( 'SELECT 1 FROM events' ) ).toHaveLength( 1 )
    expect( rows( 'SELECT 1 FROM jobs' ) ).toHaveLength( 1 )
  } )

  it( 'answers 409 while the reply is running', async () => {
    await post( 'First' )
    temp.db.$client.prepare( "UPDATE jobs SET status = 'running', lease_expires_at = 99 WHERE id = 1" ).run()

    expect( ( await post( 'Second' ) ).status ).toBe( 409 )
  } )

  it( 'accepts the next message once the reply has finished', async () => {
    await post( 'First' )
    temp.db.$client.prepare( "UPDATE jobs SET status = 'failed', error = 'no handler', finished_at = 99 WHERE id = 1" ).run()

    expect( ( await post( 'Second' ) ).status ).toBe( 201 )
  } )

  it( 'publishes MessageCompleted on the bus after the response is committed', async () => {
    const seen: EventRow[] = []
    bus.subscribe( ( event ) => {
      if( 'id' in event ) {
        seen.push( event )
      }
    } )

    const { message } = messageEnvelope.parse( ( await post( 'Hello' ) ).body )

    expect( seen ).toHaveLength( 1 )
    expect( seen[ 0 ] ).toMatchObject( { type: 'MessageCompleted', payload: { message_id: message.id } } )
  } )

  it( 'wakes the worker, whose stub then fails the job with "no handler"', async () => {
    const worker = createWorker( {
      db: temp.db,
      bus,
      leaseMs: 900_000,
      runStep: () => Promise.resolve( { ok: false, error: 'no handler', retryable: false } ),
    } )
    const failed = new Promise< EventRow >( ( resolve ) => {
      bus.subscribe( ( event ) => {
        if( 'id' in event && event.type === 'JobFailed' ) {
          resolve( event )
        }
      } )
    } )
    worker.start()

    await post( 'Hello' )

    expect( await failed ).toMatchObject( { type: 'JobFailed', payload: { job_id: 1, error: 'no handler' } } )
    expect( readJob( temp.db, 1 ) ).toMatchObject( { status: 'failed', error: 'no handler' } )

    await worker.stop()
  } )
} )

describe( 'GET /api/projects/:projectId/threads/:agent', () => {
  it( 'answers 200 { project_id, thread, messages } oldest first', async () => {
    await post( 'First' )
    temp.db.$client.prepare( "UPDATE jobs SET status = 'succeeded', finished_at = 99 WHERE id = 1" ).run()
    await post( 'Second' )

    const { status, body } = await app.request( `/api/projects/${ projectId }/threads/pm` )

    expect( status ).toBe( 200 )
    const thread = threadEnvelope.parse( body )
    expect( thread ).toMatchObject( { project_id: projectId, thread: 'pm' } )
    expect( thread.messages.map( ( message ) => message.content ) ).toEqual( [ 'First', 'Second' ] )
  } )

  it( 'answers an empty sa thread for a new project', async () => {
    const { status, body } = await app.request( `/api/projects/${ projectId }/threads/sa` )

    expect( status ).toBe( 200 )
    expect( body ).toEqual( { project_id: projectId, thread: 'sa', messages: [] } )
  } )

  it.each( [ 'human', 'dba', 'nobody' ] )( 'answers 400 for the thread "%s"', async ( agent ) => {
    const { status, body } = await app.request( `/api/projects/${ projectId }/threads/${ agent }` )

    expect( status ).toBe( 400 )
    expect( body ).toMatchObject( { error: 'Bad Request' } )
  } )

  it( 'answers 404 { error } for an unknown project', async () => {
    const { status, body } = await app.request( '/api/projects/nope/threads/pm' )

    expect( status ).toBe( 404 )
    expect( body ).toEqual( { error: expect.any( String ) } )
  } )
} )
