// Packages
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// Config
import { models } from '#src/config.js'
// DB
import { messages, type JobRow } from '#src/db/schema.js'
// Services
import { completeJob } from '#src/services/jobs.service.js'
// Worker
import { callStep } from '../step-client.js'
import type { StepOutcome } from '../worker.js'
import { createPmDiscoveryReplyHandler } from './pm-discovery-reply.handler.js'
// Test support
import { startFakeAgentService, type FakeAgentService } from '#src/test-support/fake-agent-service.js'
import { insertJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

const promptHash = 'b'.repeat( 64 )
const resultLine = { type: 'result', prompt_hash: promptHash, output: { output_type: 'chat_reply', content: 'Tell me more.' } }

let temp: TempDatabase
let bus: Bus
let service: FakeAgentService
let controller: AbortController
let job: JobRow

function addMessage( content: string, overrides: Partial< typeof messages.$inferInsert > = {} ): number {
  return temp.db.insert( messages ).values( { project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content, ...overrides } ).returning( { id: messages.id } ).get().id
}

function realHandler(): ReturnType< typeof createPmDiscoveryReplyHandler > {
  const deps = { db: temp.db, bus, agentsUrl: service.url, stepIdleMs: 60_000, stepTotalMs: 600_000 }

  return createPmDiscoveryReplyHandler( { db: temp.db, call: ( input ) => callStep( deps, input ) } )
}

function answer( messageId: number, overrides: Partial< typeof job > = {} ): void {
  job = { ...insertJob( temp.db, { input: { message_id: messageId } } ), attempts: 2, ...overrides }
}

beforeEach( async () => {
  // same approach as the step client tests: fake setTimeout, real sockets
  vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } )
  temp = createTempDatabase()
  temp.db.$client.prepare( "INSERT INTO projects ( id, name, current_state ) VALUES ( 'p1', 'Huddle', 'DISCOVERY' )" ).run()
  bus = createBus()
  service = await startFakeAgentService( ( { write, end } ) => {
    write( resultLine )
    end()
  } )
  controller = new AbortController()
} )

afterEach( async () => {
  controller.abort()
  vi.useRealTimers()
  await service.close()
  temp.cleanup()
} )

describe( 'pm_discovery_reply request', () => {
  it( 'sends job_id, attempt (the claimed attempts), kind, agent, the configured model and the context', async () => {
    addMessage( 'Earlier' )
    answer( addMessage( 'Build me a tracker' ) )

    await realHandler()( job, controller.signal )

    expect( service.requests ).toHaveLength( 1 )
    expect( service.requests[ 0 ]?.body ).toEqual( {
      job_id: job.id,
      attempt: 2,
      kind: 'pm_discovery_reply',
      agent: 'pm',
      model: models.pm_discovery_reply,
      context: {
        project: { id: 'p1', name: 'Huddle' },
        artifacts: [],
        decisions: [],
        draft: [],
        questions: [],
        messages: [ { author: 'human', kind: 'chat', content: 'Earlier' }, { author: 'human', kind: 'chat', content: 'Build me a tracker' } ],
        task: { notes: '', mode: 'normal', may_ask: false },
      },
    } )
    expect( models.pm_discovery_reply ).toBe( 'claude-sonnet-5-5' )
  } )

  it( 'leaves out messages after the one being answered', async () => {
    const answered = addMessage( 'one' )
    addMessage( 'later' )
    answer( answered )

    await realHandler()( job, controller.signal )

    const { context } = service.requests[ 0 ]?.body as { context: { messages: unknown[] } }

    expect( context.messages ).toEqual( [ { author: 'human', kind: 'chat', content: 'one' } ] )
  } )

  it( 'passes the abort signal to the step client', async () => {
    answer( addMessage( 'Hi' ) )
    const call = vi.fn( () => Promise.resolve( { ok: false, error: 'x', retryable: true } as StepOutcome ) )

    await createPmDiscoveryReplyHandler( { db: temp.db, call } )( job, controller.signal )

    expect( call ).toHaveBeenCalledWith( expect.objectContaining( { job, signal: controller.signal } ) )
  } )
} )

describe( 'pm_discovery_reply outcome', () => {
  it( 'stores { output, prompt_hash } as the job result', async () => {
    answer( addMessage( 'Hi' ) )

    const outcome = await realHandler()( job, controller.signal )

    expect( outcome ).toMatchObject( { ok: true, result: { output: { output_type: 'chat_reply', content: 'Tell me more.' }, prompt_hash: promptHash } } )
    expect( outcome.ok && Object.keys( outcome.result ).sort() ).toEqual( [ 'output', 'prompt_hash' ] )
  } )

  it( 'returns an apply that writes the pm chat message with the job_id and the content exactly as returned', async () => {
    service.respondWith( ( { write, end } ) => {
      write( { ...resultLine, output: { output_type: 'chat_reply', content: '  Line one\n\nLine two  ' } } )
      end()
    } )
    answer( addMessage( 'Hi' ) )
    const outcome = await realHandler()( job, controller.signal )
    temp.db.$client.prepare( "UPDATE jobs SET status = 'running', attempts = 2, lease_expires_at = 1 WHERE id = ?" ).run( job.id )

    expect( outcome.ok ).toBe( true )

    completeJob( temp.db, bus, { job, result: outcome.ok ? outcome.result : {}, now: 5, apply: outcome.ok ? outcome.apply : undefined } )

    const reply = temp.db.$client.prepare( "SELECT thread, author, kind, content, job_id FROM messages WHERE author = 'pm'" ).get()

    expect( reply ).toEqual( { thread: 'pm', author: 'pm', kind: 'chat', content: '  Line one\n\nLine two  ', job_id: job.id } )
  } )

  it( 'writes nothing itself: the message only appears when apply runs', async () => {
    answer( addMessage( 'Hi' ) )

    await realHandler()( job, controller.signal )

    expect( ( temp.db.$client.prepare( 'SELECT COUNT(*) AS count FROM messages' ).get() as { count: number } ).count ).toBe( 1 )
  } )

  it( 'passes a failed step outcome through unchanged', async () => {
    service.respondWith( ( { write, end } ) => {
      write( { type: 'error', code: 'overloaded', message: 'busy', retryable: true } )
      end()
    } )
    answer( addMessage( 'Hi' ) )

    expect( await realHandler()( job, controller.signal ) ).toEqual( { ok: false, error: 'overloaded: busy', retryable: true } )
  } )

  it( 'fails as non-retryable when output_type does not match the kind map', async () => {
    answer( addMessage( 'Hi' ) )
    const call = vi.fn( () => Promise.resolve( { ok: true, result: { type: 'result', prompt_hash: promptHash, output: { output_type: 'review', notes: 'x' } } } as StepOutcome ) )

    const outcome = await createPmDiscoveryReplyHandler( { db: temp.db, call } )( job, controller.signal )

    expect( outcome ).toEqual( { ok: false, error: 'output_type mismatch: expected chat_reply, got review', retryable: false } )
  } )
} )
