// Packages
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Shared
import { projectEnvelope } from '@my-team/shared'
// App
import { createApp } from '#src/app.js'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// Worker
import { createWorker, type Worker } from '#src/worker/worker.js'
// Test support
import { connectSse, type SseClient } from '#src/test-support/sse-client.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'
import { startTestApp, type TestApp } from '#src/test-support/test-app.js'

interface Frame {
  id: number
  type: string
}

let temp: TempDatabase
let bus: Bus
let app: TestApp
let worker: Worker
let client: SseClient
let projectId: string

async function nextFrames( count: number ): Promise< Frame[] > {
  const frames: Frame[] = []

  for( let index = 0; index < count; index += 1 ) {
    const frame = await client.next()
    const [ idLine, dataLine ] = frame.split( '\n' )

    frames.push( { id: Number( idLine.slice( 'id: '.length ) ), type: ( JSON.parse( dataLine.slice( 'data: '.length ) ) as { type: string } ).type } )
  }

  return frames
}

function post( content: string ): Promise< unknown > {
  return app.request( `/api/projects/${ projectId }/messages`, { method: 'POST', body: { thread: 'pm', content } } )
}

beforeEach( async () => {
  temp = createTempDatabase()
  bus = createBus()
  app = await startTestApp( createApp( { db: temp.db, bus } ) )
  worker = createWorker( {
    db: temp.db,
    bus,
    leaseMs: 900_000,
    runStep: () => Promise.resolve( { ok: false, error: 'no handler', retryable: false } ),
  } )
  worker.start()
  client = await connectSse( `${ app.url }/api/stream?since=0` )
  projectId = projectEnvelope.parse( ( await app.request( '/api/projects', { method: 'POST', body: { name: 'Huddle' } } ) ).body ).project.id
} )

afterEach( async () => {
  client.close()
  await worker.stop()
  await vi.waitFor( () => expect( bus.listenerCount() ).toBe( 0 ) )
  await app.close()
  temp.cleanup()
} )

describe( 'the stream while the worker runs', () => {
  it( 'carries MessageCompleted, JobClaimed and JobFailed in order with consecutive ids, for each message', async () => {
    await post( 'Hello' )
    const first = await nextFrames( 3 )

    expect( first.map( ( frame ) => frame.type ) ).toEqual( [ 'MessageCompleted', 'JobClaimed', 'JobFailed' ] )
    expect( first.map( ( frame ) => frame.id ) ).toEqual( [ 1, 2, 3 ] )

    await post( 'Again' )
    const second = await nextFrames( 3 )

    expect( second.map( ( frame ) => frame.type ) ).toEqual( [ 'MessageCompleted', 'JobClaimed', 'JobFailed' ] )
    expect( second.map( ( frame ) => frame.id ) ).toEqual( [ 4, 5, 6 ] )
  } )
} )
