// Packages
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Shared
import { stepRequest, type StepRequest } from '@huddle/shared'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import type { JobRow } from '#src/db/schema.js'
// Logger
import { logger } from '#src/logger.js'
// Worker
import { callStep, type StepClientDeps } from './step-client.js'
import { createWorker, type StepOutcome, type Worker } from './worker.js'
// Test support
import { startFakeAgentService, type Exchange, type ExchangeHandler, type FakeAgentService } from '#src/test-support/fake-agent-service.js'
import { insertJob, readJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

const sonnet = 'claude-sonnet-5-5'
const idleMs = 60_000
const totalMs = 600_000

const resultLine = { type: 'result', prompt_hash: 'a'.repeat( 64 ), output: { output_type: 'chat_reply', content: 'Hello' } }
const heartbeat = { type: 'heartbeat' }

function delta( text: string ): { type: 'delta', text: string } {
  return { type: 'delta', text }
}

function usage( overrides: Record< string, unknown > = {} ): Record< string, unknown > {
  return { type: 'usage', model: sonnet, input_tokens: 1_000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0, ...overrides }
}

function errorLine( retryable: boolean, code = 'upstream_error' ): Record< string, unknown > {
  return { type: 'error', code, message: 'it broke', retryable }
}

let temp: TempDatabase
let bus: Bus
let service: FakeAgentService
let job: JobRow
let request: StepRequest
let controller: AbortController
let linesSeen: number
let lineWaiters: { count: number, resolve(): void }[]

function deps( overrides: Partial< StepClientDeps > = {} ): StepClientDeps {
  return { db: temp.db, bus, agentsUrl: service.url, stepIdleMs: idleMs, stepTotalMs: totalMs, ...overrides }
}

function start( overrides: Partial< StepClientDeps > = {} ): Promise< StepOutcome > {
  return callStep( deps( overrides ), { job, request, signal: controller.signal } )
}

function untilLines( count: number ): Promise< void > {
  if( linesSeen >= count ) {
    return Promise.resolve()
  }

  return new Promise( ( resolve ) => lineWaiters.push( { count, resolve } ) )
}

// fake timers leave real sockets alone, so give them a few turns to deliver before checking that something has not happened
async function flushIo(): Promise< void > {
  for( let turn = 0; turn < 5; turn++ ) {
    await new Promise< void >( ( resolve ) => setImmediate( resolve ) )
  }
}

// the handler returns at once so the exchange stays open and the test drives it
function holdExchange(): Promise< Exchange > {
  return new Promise( ( resolve ) => {
    service.respondWith( ( exchange ) => resolve( exchange ) )
  } )
}

function reply( handler: ExchangeHandler ): void {
  service.respondWith( handler )
}

function track( call: Promise< StepOutcome > ): { done: boolean } {
  const state = { done: false }

  void call.then( () => {
    state.done = true
  } )

  return state
}

function llmCalls(): { model: string, cost_micro_usd: number, job_id: number }[] {
  return temp.db.$client.prepare( 'SELECT model, cost_micro_usd, job_id FROM llm_calls ORDER BY id' ).all() as { model: string, cost_micro_usd: number, job_id: number }[]
}

function count( table: string ): number {
  return ( temp.db.$client.prepare( `SELECT COUNT(*) AS count FROM ${ table }` ).get() as { count: number } ).count
}

beforeEach( async () => {
  vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } )
  temp = createTempDatabase()
  bus = createBus()
  service = await startFakeAgentService()
  job = insertJob( temp.db, { agent: 'pm' } )
  controller = new AbortController()
  request = stepRequest.parse( {
    job_id: job.id,
    attempt: 1,
    kind: 'pm_discovery_reply',
    agent: 'pm',
    model: sonnet,
    context: {
      project: { id: 'p1', name: 'Huddle' },
      artifacts: [],
      decisions: [],
      draft: [],
      questions: [],
      messages: [ { author: 'human', kind: 'chat', content: 'Hi' } ],
      task: { notes: '', mode: 'normal', may_ask: false },
    },
  } )

  // the client logs each valid line at debug once it has handled it, which is the only way a test can see that a heartbeat arrived
  linesSeen = 0
  lineWaiters = []
  vi.spyOn( logger, 'debug' ).mockImplementation( () => {
    linesSeen++
    lineWaiters = lineWaiters.filter( ( waiter ) => {
      if( linesSeen < waiter.count ) {
        return true
      }

      waiter.resolve()

      return false
    } )
  } )
} )

afterEach( async () => {
  controller.abort()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await service.close()
  temp.cleanup()
} )

describe( 'callStep request', () => {
  it( 'POSTs the request as JSON to /v1/steps', async () => {
    reply( ( { write, end } ) => {
      write( resultLine )
      end()
    } )

    await start()

    expect( service.requests ).toHaveLength( 1 )
    expect( service.requests[ 0 ] ).toMatchObject( { method: 'POST', path: '/v1/steps', body: request } )
    expect( service.requests[ 0 ].contentType ).toContain( 'application/json' )
  } )

  it( 'does not send a request that fails the generated StepRequest check, and the outcome is not retryable', async () => {
    const outcome = await callStep( deps(), { job, request: { ...request, attempt: 0 }, signal: controller.signal } )

    expect( outcome ).toMatchObject( { ok: false, retryable: false } )
    expect( outcome.ok === false && outcome.error ).toMatch( /^contract: / )
    expect( service.requests ).toHaveLength( 0 )
  } )

  it( 'does not call the agent service when the signal is already aborted', async () => {
    controller.abort()

    const outcome = await start()

    expect( outcome ).toEqual( { ok: false, error: 'aborted', retryable: true } )
    expect( service.requests ).toHaveLength( 0 )
  } )

  it( 'has no transaction open while the agent service is being called', async () => {
    let inTransaction: boolean | undefined

    reply( ( { write, end } ) => {
      inTransaction = temp.db.$client.inTransaction
      write( resultLine )
      end()
    } )

    await start()

    expect( inTransaction ).toBe( false )
  } )
} )

describe( 'callStep success', () => {
  it( 'returns the parsed result line', async () => {
    reply( ( { write, end } ) => {
      write( resultLine )
      end()
    } )

    expect( await start() ).toEqual( { ok: true, result: resultLine } )
  } )

  it( 'skips blank lines', async () => {
    reply( ( { writeRaw, write, end } ) => {
      writeRaw( '\n\n' )
      write( resultLine )
      end()
    } )

    expect( await start() ).toMatchObject( { ok: true } )
  } )

  it( 'reads a line that arrives in pieces', async () => {
    reply( ( { writeRaw, end } ) => {
      const text = JSON.stringify( resultLine )

      writeRaw( text.slice( 0, 20 ) )
      writeRaw( text.slice( 20, 70 ) )
      writeRaw( `${ text.slice( 70 ) }\n` )
      end()
    } )

    expect( await start() ).toEqual( { ok: true, result: resultLine } )
  } )

  it( 'reads a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode( `${ JSON.stringify( { ...resultLine, output: { output_type: 'chat_reply', content: 'cost €5' } } ) }\n` )
    const euro = new TextEncoder().encode( '€' )
    const middle = bytes.findIndex( ( byte, index ) => byte === euro[ 0 ] && bytes[ index + 1 ] === euro[ 1 ] ) + 1

    reply( ( { writeRaw, end } ) => {
      writeRaw( bytes.slice( 0, middle ) )
      writeRaw( bytes.slice( middle ) )
      end()
    } )

    expect( await start() ).toMatchObject( { ok: true, result: { output: { content: 'cost €5' } } } )
  } )

  it( 'ends the call at the first result: the connection is closed and later lines are ignored', async () => {
    const exchange = holdExchange()

    const call = start()
    const { write, closed } = await exchange

    write( resultLine )
    write( usage() )
    write( errorLine( false ) )

    expect( await call ).toEqual( { ok: true, result: resultLine } )
    await closed
    expect( llmCalls() ).toEqual( [] )
  } )

  it( 'reads a final result line that has no trailing newline', async () => {
    reply( ( { writeRaw, end } ) => {
      writeRaw( JSON.stringify( resultLine ) )
      end()
    } )

    expect( await start() ).toEqual( { ok: true, result: resultLine } )
  } )

  it( 'fails without retry when the unterminated final line is not JSON', async () => {
    reply( ( { writeRaw, end } ) => {
      writeRaw( '{"type":"result","prompt_h' )
      end()
    } )

    const outcome = await start()

    expect( outcome ).toMatchObject( { ok: false, retryable: false } )
    expect( outcome.ok === false && outcome.error ).toMatch( /^contract: / )
  } )

  it( 'fails without retry when the unterminated final line fails the StepLine check', async () => {
    reply( ( { writeRaw, end } ) => {
      writeRaw( JSON.stringify( { type: 'usage', model: sonnet } ) )
      end()
    } )

    const outcome = await start()

    expect( outcome ).toMatchObject( { ok: false, retryable: false } )
    expect( outcome.ok === false && outcome.error ).toMatch( /^contract: / )
  } )

  it( 'still ends as a missing result when the leftover is only whitespace', async () => {
    reply( ( { write, writeRaw, end } ) => {
      write( delta( 'Hel' ) )
      writeRaw( '  ' )
      end()
    } )

    expect( await start() ).toEqual( { ok: false, error: 'stream ended without result', retryable: true } )
  } )
} )

describe( 'callStep deltas', () => {
  it( 'publishes each delta on the bus in order', async () => {
    const published: unknown[] = []

    bus.subscribe( ( event ) => published.push( event ) )
    reply( ( { write, end } ) => {
      write( delta( 'Hel' ) )
      write( delta( 'lo' ) )
      write( resultLine )
      end()
    } )

    await start()

    expect( published ).toEqual( [
      { project_id: 'p1', job_id: job.id, text: 'Hel' },
      { project_id: 'p1', job_id: job.id, text: 'lo' },
    ] )
  } )

  it( 'never stores a delta', async () => {
    reply( ( { write, end } ) => {
      write( delta( 'Hello' ) )
      write( resultLine )
      end()
    } )

    const before = { events: count( 'events' ), messages: count( 'messages' ), llm_calls: count( 'llm_calls' ) }

    await start()

    expect( { events: count( 'events' ), messages: count( 'messages' ), llm_calls: count( 'llm_calls' ) } ).toEqual( before )
  } )
} )

describe( 'callStep usage', () => {
  it( 'writes an llm_calls row priced in integer micro-dollars', async () => {
    reply( ( { write, end } ) => {
      write( usage() )
      write( resultLine )
      end()
    } )

    await start()

    expect( llmCalls() ).toEqual( [ { model: sonnet, cost_micro_usd: 7_000, job_id: job.id } ] )
  } )

  it( 'writes each usage line as its own row the moment it arrives, before the call has finished', async () => {
    const exchange = holdExchange()

    const call = start()
    const { write } = await exchange

    write( usage() )
    await untilLines( 1 )

    expect( llmCalls() ).toHaveLength( 1 )
    expect( temp.db.$client.inTransaction ).toBe( false )

    write( usage( { input_tokens: 2_000, output_tokens: 0 } ) )
    await untilLines( 2 )

    expect( llmCalls().map( ( row ) => row.cost_micro_usd ) ).toEqual( [ 7_000, 4_000 ] )

    write( resultLine )
    await call
  } )

  it( 'keeps the row when the call then fails with a non-retryable error line', async () => {
    reply( ( { write, end } ) => {
      write( usage() )
      write( errorLine( false, 'truncated' ) )
      end()
    } )

    expect( await start() ).toMatchObject( { ok: false } )
    expect( llmCalls() ).toHaveLength( 1 )
  } )

  it( 'keeps the row when the connection is then reset', async () => {
    const exchange = holdExchange()

    const call = start()
    const { write, destroy } = await exchange

    write( usage() )
    await untilLines( 1 )
    destroy()

    expect( await call ).toEqual( { ok: false, error: 'connection failed', retryable: true } )
    expect( llmCalls() ).toHaveLength( 1 )
  } )

  it( 'prices an unpriced model at the requested model, stores the returned model string, warns, and does not fail the job', async () => {
    const warn = vi.spyOn( logger, 'warn' )

    reply( ( { write, end } ) => {
      write( usage( { model: 'claude-sonnet-5-5-20271201' } ) )
      write( resultLine )
      end()
    } )

    expect( await start() ).toMatchObject( { ok: true } )
    expect( llmCalls() ).toEqual( [ { model: 'claude-sonnet-5-5-20271201', cost_micro_usd: 7_000, job_id: job.id } ] )
    expect( warn ).toHaveBeenCalledTimes( 1 )
  } )
} )

describe( 'callStep error lines', () => {
  it( 'returns a retryable outcome for an error line with retryable: true', async () => {
    reply( ( { write, end } ) => {
      write( { type: 'error', code: 'rate_limited', message: 'slow down', retryable: true } )
      end()
    } )

    expect( await start() ).toEqual( { ok: false, error: 'rate_limited: slow down', retryable: true } )
  } )

  it( 'returns a non-retryable outcome for an error line with retryable: false', async () => {
    reply( ( { write, end } ) => {
      write( { type: 'error', code: 'unknown_kind', message: 'no such kind', retryable: false } )
      end()
    } )

    expect( await start() ).toEqual( { ok: false, error: 'unknown_kind: no such kind', retryable: false } )
  } )

  it( 'ends the call at the first error line and ignores what follows', async () => {
    const exchange = holdExchange()

    const call = start()
    const { write, closed } = await exchange

    write( errorLine( true ) )
    write( resultLine )

    expect( await call ).toMatchObject( { ok: false, retryable: true } )
    await closed
  } )
} )

describe( 'callStep contract drift', () => {
  it.each( [
    [ 'a usage line missing its tokens', { type: 'usage', model: sonnet } ],
    [ 'a line with an unknown type', { type: 'banana' } ],
    [ 'a result with a malformed prompt hash', { ...resultLine, prompt_hash: 'xyz' } ],
    [ 'a heartbeat carrying extra fields', { type: 'heartbeat', extra: 1 } ],
  ] )( 'fails without retry on %s', async ( _name, line ) => {
    reply( ( { write, end } ) => {
      write( line )
      end()
    } )

    const outcome = await start()

    expect( outcome ).toMatchObject( { ok: false, retryable: false } )
    expect( outcome.ok === false && outcome.error ).toMatch( /^contract: / )
  } )

  it( 'fails without retry on a line that is not JSON', async () => {
    reply( ( { writeRaw, end } ) => {
      writeRaw( 'not json\n' )
      end()
    } )

    const outcome = await start()

    expect( outcome ).toMatchObject( { ok: false, retryable: false } )
    expect( outcome.ok === false && outcome.error ).toMatch( /^contract: / )
  } )
} )

describe( 'callStep connection failures', () => {
  it( 'is retryable when the stream ends without a result or error', async () => {
    reply( ( { write, end } ) => {
      write( delta( 'Hel' ) )
      end()
    } )

    expect( await start() ).toEqual( { ok: false, error: 'stream ended without result', retryable: true } )
  } )

  it( 'is retryable when the connection is refused', async () => {
    const { url } = service

    await service.close()

    expect( await start( { agentsUrl: url } ) ).toEqual( { ok: false, error: 'connection failed', retryable: true } )
    service = await startFakeAgentService()
  } )

  it( 'is retryable when the connection is reset before any response', async () => {
    reply( ( { destroy } ) => destroy() )

    expect( await start() ).toEqual( { ok: false, error: 'connection failed', retryable: true } )
  } )

  it.each( [ 400, 404, 500, 503 ] )( 'is retryable on http %i', async ( status ) => {
    reply( ( { writeHead, end } ) => {
      writeHead( status )
      end()
    } )

    expect( await start() ).toEqual( { ok: false, error: `http ${ status }`, retryable: true } )
  } )
} )

describe( 'callStep timeouts', () => {
  it( 'aborts after 60 s with no line, even before the response headers', async () => {
    void holdExchange()

    const call = start()
    const state = track( call )

    await vi.advanceTimersByTimeAsync( idleMs - 1 )
    await flushIo()

    expect( state.done ).toBe( false )

    await vi.advanceTimersByTimeAsync( 1 )

    expect( await call ).toEqual( { ok: false, error: 'idle timeout', retryable: true } )
  } )

  it( 'closes the connection when it times out', async () => {
    const exchange = holdExchange()

    const call = start()
    const { write, closed } = await exchange

    write( delta( 'Hel' ) )
    await untilLines( 1 )
    await vi.advanceTimersByTimeAsync( idleMs )

    expect( await call ).toEqual( { ok: false, error: 'idle timeout', retryable: true } )
    await closed
  } )

  it( 'restarts the 60 s idle timer on every line', async () => {
    const exchange = holdExchange()

    const call = start()
    const state = track( call )
    const { write } = await exchange

    await vi.advanceTimersByTimeAsync( idleMs - 1 )
    write( delta( 'Hel' ) )
    await untilLines( 1 )
    await vi.advanceTimersByTimeAsync( idleMs - 1 )
    await flushIo()

    expect( state.done ).toBe( false )

    await vi.advanceTimersByTimeAsync( 1 )

    expect( await call ).toEqual( { ok: false, error: 'idle timeout', retryable: true } )
  } )

  it( 'a heartbeat only resets the idle timer: nothing is published or stored', async () => {
    const published: unknown[] = []

    bus.subscribe( ( event ) => published.push( event ) )

    const exchange = holdExchange()
    const call = start()
    const state = track( call )
    const { write } = await exchange
    const before = { events: count( 'events' ), llm_calls: count( 'llm_calls' ), messages: count( 'messages' ) }

    await vi.advanceTimersByTimeAsync( 50_000 )
    write( heartbeat )
    await untilLines( 1 )
    await vi.advanceTimersByTimeAsync( idleMs - 1 )
    await flushIo()

    expect( state.done ).toBe( false )

    await vi.advanceTimersByTimeAsync( 1 )

    expect( await call ).toEqual( { ok: false, error: 'idle timeout', retryable: true } )
    expect( published ).toEqual( [] )
    expect( { events: count( 'events' ), llm_calls: count( 'llm_calls' ), messages: count( 'messages' ) } ).toEqual( before )
  } )

  it( 'aborts after 10 minutes in total, however often heartbeats arrive', async () => {
    const exchange = holdExchange()

    const call = start()
    const state = track( call )
    const { write } = await exchange

    for( let beat = 1; beat <= 11; beat++ ) {
      await vi.advanceTimersByTimeAsync( 50_000 )
      write( heartbeat )
      await untilLines( beat )
    }

    await vi.advanceTimersByTimeAsync( totalMs - 550_000 - 1 )
    await flushIo()

    expect( state.done ).toBe( false )

    await vi.advanceTimersByTimeAsync( 1 )

    expect( await call ).toEqual( { ok: false, error: 'total timeout', retryable: true } )
  } )

  it( 'stops both timers once the call has finished', async () => {
    reply( ( { write, end } ) => {
      write( resultLine )
      end()
    } )

    await start()

    expect( vi.getTimerCount() ).toBe( 0 )
  } )
} )

describe( 'callStep caller abort', () => {
  it( 'closes the connection and returns an aborted outcome when the signal fires mid-stream', async () => {
    const exchange = holdExchange()

    const call = start()
    const { write, closed } = await exchange

    write( delta( 'Hel' ) )
    await untilLines( 1 )
    controller.abort()

    expect( await call ).toEqual( { ok: false, error: 'aborted', retryable: true } )
    await closed
    expect( vi.getTimerCount() ).toBe( 0 )
  } )
} )

describe( 'worker with the step client: an agent service that is late', () => {
  let worker: Worker

  function startWorker(): void {
    worker = createWorker( {
      db: temp.db,
      bus,
      leaseMs: 900_000,
      runStep: ( claimed, signal ) => callStep( deps(), { job: claimed, request: { ...request, attempt: claimed.attempts }, signal } ),
    } )
    worker.start()
  }

  // real socket I/O has no event to wait on here, so turn the event loop until the database shows the result
  async function until( condition: () => boolean ): Promise< void > {
    for( let turn = 0; turn < 1_000 && !condition(); turn++ ) {
      await new Promise< void >( ( resolve ) => setImmediate( resolve ) )
    }

    expect( condition() ).toBe( true )
  }

  function eventTypes(): string[] {
    return ( temp.db.$client.prepare( 'SELECT type FROM events ORDER BY id' ).all() as { type: string }[] ).map( ( { type } ) => type )
  }

  afterEach( async () => {
    await worker.stop()
  } )

  it( 'times out the silent call, re-queues the job, and completes it when the service answers on the retry', async () => {
    const first = holdExchange()

    startWorker()
    await first

    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'running', attempts: 1 } )

    await vi.advanceTimersByTimeAsync( idleMs )
    await until( () => readJob( temp.db, job.id ).status === 'queued' )

    expect( readJob( temp.db, job.id ) ).toMatchObject( { attempts: 1, lease_expires_at: null, finished_at: null } )
    expect( eventTypes() ).not.toContain( 'JobFailed' )

    // the retry backoff is real time, which fake timers don't move, so make the job ready and wake the worker
    temp.db.$client.prepare( 'UPDATE jobs SET run_after = 0' ).run()
    reply( ( { write, end } ) => {
      write( usage() )
      write( resultLine )
      end()
    } )
    bus.publish( { id: 1, project_id: 'p1', type: 'JobClaimed', actor: null, payload: {}, created_at: 0 } )
    await until( () => readJob( temp.db, job.id ).status === 'succeeded' )

    expect( readJob( temp.db, job.id ) ).toMatchObject( { attempts: 2, result: resultLine } )
    expect( service.requests ).toHaveLength( 2 )
    expect( llmCalls() ).toHaveLength( 1 )
    expect( eventTypes() ).toContain( 'JobCompleted' )
  } )

  it( 'fails the job with the timeout label when the late call was the last attempt', async () => {
    temp.db.$client.prepare( 'UPDATE jobs SET max_attempts = 1' ).run()

    const first = holdExchange()

    startWorker()
    await first
    await vi.advanceTimersByTimeAsync( idleMs )
    await until( () => readJob( temp.db, job.id ).status === 'failed' )

    expect( readJob( temp.db, job.id ) ).toMatchObject( { error: 'idle timeout', attempts: 1 } )
    expect( eventTypes() ).toContain( 'JobFailed' )
  } )

  it( 'fails the job at once, without retry, when the service sends a non-retryable error line', async () => {
    reply( ( { write, end } ) => {
      write( { type: 'error', code: 'unknown_kind', message: 'no such kind', retryable: false } )
      end()
    } )

    startWorker()
    await until( () => readJob( temp.db, job.id ).status === 'failed' )

    expect( readJob( temp.db, job.id ) ).toMatchObject( { error: 'unknown_kind: no such kind', attempts: 1 } )
  } )
} )
