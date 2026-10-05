// Packages
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import { messages } from '#src/db/schema.js'
// Services
import { createProject } from '#src/services/projects.service.js'
import { sendMessage } from '#src/services/messages.service.js'
// Worker
import { createDispatcher } from './dispatcher.js'
import { createPmDiscoveryReplyHandler } from './handlers/pm-discovery-reply.handler.js'
import { callStep } from './step-client.js'
import { createWorker, type Worker } from './worker.js'
// Test support
import { startFakeAgentService, type FakeAgentService } from '#src/test-support/fake-agent-service.js'
import { readJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

const promptHash = 'c'.repeat( 64 )

let temp: TempDatabase
let bus: Bus
let service: FakeAgentService
let worker: Worker | undefined
let projectId: string

function startWorker(): Worker {
  const deps = { db: temp.db, bus, agentsUrl: service.url, stepIdleMs: 60_000, stepTotalMs: 600_000 }
  const handler = createPmDiscoveryReplyHandler( { db: temp.db, call: ( input ) => callStep( deps, input ) } )

  worker = createWorker( { db: temp.db, bus, leaseMs: 900_000, runStep: createDispatcher( { pm_discovery_reply: handler } ) } )
  worker.start()

  return worker
}

function eventTypes(): string[] {
  return ( temp.db.$client.prepare( 'SELECT type FROM events ORDER BY id' ).all() as { type: string }[] ).map( ( { type } ) => type )
}

beforeEach( async () => {
  vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } )
  temp = createTempDatabase()
  bus = createBus()
  worker = undefined
  service = await startFakeAgentService( ( { write, end } ) => {
    write( { type: 'delta', text: 'Tell ' } )
    write( { type: 'usage', model: 'fake', input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0 } )
    write( { type: 'result', prompt_hash: promptHash, output: { output_type: 'chat_reply', content: 'Tell me more.' } } )
    end()
  } )
  projectId = createProject( temp.db, bus, { name: 'Huddle' } ).id
} )

afterEach( async () => {
  await worker?.stop()
  vi.useRealTimers()
  await service.close()
  temp.cleanup()
} )

describe( 'first real reply', () => {
  it( 'answers a Naresh message with the pm message, MessageCompleted and JobCompleted, and records cost', async () => {
    const asked = sendMessage( temp.db, bus, { projectId, thread: 'pm', content: 'Build me a tracker', author: 'human' } )
    const published: string[] = []
    bus.subscribe( ( event ) => {
      if( 'id' in event ) {
        published.push( event.type )
      }
    } )

    startWorker()
    await vi.waitFor( () => expect( readJob( temp.db, 1 ).status ).toBe( 'succeeded' ) )

    expect( readJob( temp.db, 1 ).result ).toEqual( { output: { output_type: 'chat_reply', content: 'Tell me more.' }, prompt_hash: promptHash } )
    expect( temp.db.select().from( messages ).all().map( ( { thread, author, kind, content, job_id } ) => ( { thread, author, kind, content, job_id } ) ) ).toEqual( [
      { thread: 'pm', author: 'human', kind: 'chat', content: 'Build me a tracker', job_id: null },
      { thread: 'pm', author: 'pm', kind: 'chat', content: 'Tell me more.', job_id: 1 },
    ] )
    expect( eventTypes() ).toEqual( [ 'MessageCompleted', 'JobClaimed', 'MessageCompleted', 'JobCompleted' ] )
    expect( published.filter( ( type ) => type !== 'JobClaimed' ) ).toEqual( [ 'MessageCompleted', 'JobCompleted' ] )
    expect( temp.db.$client.prepare( 'SELECT job_id, model FROM llm_calls' ).all() ).toEqual( [ { job_id: 1, model: 'fake' } ] )
    expect( asked.id ).toBe( 1 )
  } )

  it( 'fails the job as non-retryable when the kind has no handler', async () => {
    temp.db.$client.prepare( "INSERT INTO jobs ( project_id, kind, agent, run_after ) VALUES ( ?, 'pm_draft_brief', 'pm', 0 )" ).run( projectId )

    startWorker()
    await vi.waitFor( () => expect( readJob( temp.db, 1 ).status ).toBe( 'failed' ) )

    expect( readJob( temp.db, 1 ).error ).toBe( 'no handler for pm_draft_brief' )
    expect( service.requests ).toHaveLength( 0 )
  } )
} )
