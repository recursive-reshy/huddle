// Packages
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import { messages, type EventRow, type JobRow } from '#src/db/schema.js'
// Repositories
import { appendEvent } from '#src/repositories/events.repository.js'
// Logger
import { logger } from '#src/logger.js'
// Worker
import { createWorker, fallbackTickMs, sweepIntervalMs, type StepOutcome, type Worker } from './worker.js'
// Test support
import { insertJob, readJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

const leaseMs = 900_000

interface Deferred {
  promise: Promise< StepOutcome >
  resolve( outcome: StepOutcome ): void
}

function defer(): Deferred {
  let resolve!: ( outcome: StepOutcome ) => void
  const promise = new Promise< StepOutcome >( ( done ) => { resolve = done } )

  return { promise, resolve }
}

function untilAborted( signal: AbortSignal ): Promise< StepOutcome > {
  return new Promise( ( resolve ) => {
    signal.addEventListener( 'abort', () => resolve( { ok: false, error: 'aborted', retryable: true } ) )
  } )
}

const succeeded: StepOutcome = { ok: true, result: { done: true } }

const anyEvent: EventRow = { id: 1, project_id: 'p1', type: 'JobClaimed', actor: null, payload: {}, created_at: 0 }

let temp: TempDatabase
let bus: Bus
let worker: Worker | undefined

async function settle(): Promise< void > {
  await vi.advanceTimersByTimeAsync( 0 )
}

function startWorker( runStep: ( job: JobRow, signal: AbortSignal ) => Promise< StepOutcome > ): Worker {
  worker = createWorker( { db: temp.db, bus, runStep, leaseMs } )
  worker.start()

  return worker
}

function eventTypes(): string[] {
  return ( temp.db.$client.prepare( 'SELECT type FROM events ORDER BY id' ).all() as { type: string }[] ).map( ( { type } ) => type )
}

beforeEach( () => {
  vi.useFakeTimers()
  vi.setSystemTime( 1_000_000 )
  temp = createTempDatabase()
  bus = createBus()
  worker = undefined
} )

afterEach( async () => {
  await worker?.stop()
  vi.useRealTimers()
  temp.cleanup()
} )

describe( 'worker loop', () => {
  it( 'subscribes to the bus on start', () => {
    startWorker( () => Promise.resolve( succeeded ) )

    expect( bus.listenerCount() ).toBe( 1 )
  } )

  it( 'drains the jobs already queued when it starts, oldest first', async () => {
    const first = insertJob( temp.db )
    const second = insertJob( temp.db )
    const order: number[] = []

    startWorker( ( job ) => {
      order.push( job.id )

      return Promise.resolve( succeeded )
    } )
    await settle()

    expect( order ).toEqual( [ first.id, second.id ] )
    expect( readJob( temp.db, first.id ).status ).toBe( 'succeeded' )
    expect( readJob( temp.db, second.id ).status ).toBe( 'succeeded' )
    expect( eventTypes() ).toEqual( [ 'JobClaimed', 'JobCompleted', 'JobClaimed', 'JobCompleted' ] )
  } )

  it( 'passes the claimed job, with its lease, to the step', async () => {
    insertJob( temp.db )
    const step = vi.fn( () => Promise.resolve( succeeded ) )

    startWorker( step )
    await settle()

    expect( step ).toHaveBeenCalledWith( expect.objectContaining( { status: 'running', attempts: 1, lease_expires_at: 1_000_000 + leaseMs } ), expect.any( AbortSignal ) )
  } )

  it( 'stays idle until a bus event arrives, then wakes and claims', async () => {
    const step = vi.fn( () => Promise.resolve( succeeded ) )
    startWorker( step )
    await settle()

    const job = insertJob( temp.db )
    await settle()

    expect( step ).not.toHaveBeenCalled()

    bus.publish( anyEvent )
    await settle()

    expect( step ).toHaveBeenCalledOnce()
    expect( readJob( temp.db, job.id ).status ).toBe( 'succeeded' )
  } )

  it( 'runs one job at a time', async () => {
    const first = insertJob( temp.db )
    const second = insertJob( temp.db )
    const gate = defer()
    const started: number[] = []

    startWorker( ( job ) => {
      started.push( job.id )

      return job.id === first.id ? gate.promise : Promise.resolve( succeeded )
    } )
    await settle()
    bus.publish( anyEvent )
    await settle()

    expect( started ).toEqual( [ first.id ] )
    expect( readJob( temp.db, second.id ).status ).toBe( 'queued' )

    gate.resolve( succeeded )
    await settle()

    expect( started ).toEqual( [ first.id, second.id ] )
    expect( readJob( temp.db, second.id ).status ).toBe( 'succeeded' )
  } )

  it( 'picks up a job queued, and announced on the bus, while a step is running', async () => {
    insertJob( temp.db )
    const gate = defer()
    const started: number[] = []

    startWorker( ( job ) => {
      started.push( job.id )

      return started.length === 1 ? gate.promise : Promise.resolve( succeeded )
    } )
    await settle()

    const late = insertJob( temp.db )
    bus.publish( anyEvent )
    gate.resolve( succeeded )
    await settle()

    expect( started ).toHaveLength( 2 )
    expect( readJob( temp.db, late.id ).status ).toBe( 'succeeded' )
  } )

  it( 'holds no transaction open while the step runs', async () => {
    insertJob( temp.db )
    const gate = defer()
    let inTransaction: boolean | undefined

    startWorker( () => {
      inTransaction = temp.db.$client.inTransaction

      return gate.promise
    } )
    await settle()

    expect( inTransaction ).toBe( false )
    expect( temp.db.$client.inTransaction ).toBe( false )

    gate.resolve( succeeded )
  } )
} )

describe( 'step outcomes', () => {
  it( 'fails the job and writes JobFailed for a non-retryable error', async () => {
    const job = insertJob( temp.db )

    startWorker( () => Promise.resolve( { ok: false, error: 'contract drift', retryable: false } ) )
    await settle()

    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'failed', error: 'contract drift' } )
    expect( eventTypes() ).toEqual( [ 'JobClaimed', 'JobFailed' ] )
  } )

  it( 're-queues a retryable error and runs the job again as the next attempt', async () => {
    const job = insertJob( temp.db )
    const attempts: number[] = []

    startWorker( ( claimed ) => {
      attempts.push( claimed.attempts )

      return Promise.resolve( attempts.length === 1 ? { ok: false, error: 'timeout', retryable: true } : succeeded )
    } )
    await settle()
    await vi.advanceTimersByTimeAsync( 10_000 )

    expect( attempts ).toEqual( [ 1, 2 ] )
    expect( readJob( temp.db, job.id ).status ).toBe( 'succeeded' )
  } )

  it( 'waits out the backoff before retrying a retryable error', async () => {
    const job = insertJob( temp.db )
    const attempts: number[] = []

    startWorker( ( claimed ) => {
      attempts.push( claimed.attempts )

      return Promise.resolve( attempts.length === 1 ? { ok: false, error: 'timeout', retryable: true } : succeeded )
    } )
    await settle()

    expect( attempts ).toEqual( [ 1 ] )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'queued', run_after: 1_000_000 + 10_000 } )

    await vi.advanceTimersByTimeAsync( 10_000 )

    expect( attempts ).toEqual( [ 1, 2 ] )
    expect( readJob( temp.db, job.id ).status ).toBe( 'succeeded' )
  } )

  it( 'fails a retryable job after max_attempts', async () => {
    const job = insertJob( temp.db )
    const step = vi.fn( () => Promise.resolve( { ok: false, retryable: true, error: 'timeout' } as const ) )

    startWorker( step )
    await settle()
    await vi.advanceTimersByTimeAsync( 10_000 )
    await vi.advanceTimersByTimeAsync( 20_000 )

    expect( step ).toHaveBeenCalledTimes( 3 )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'failed', attempts: 3, error: 'timeout' } )
  } )

  it( 'fails the job as non-retryable, logs the error and carries on when the step throws', async () => {
    const logged = vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    const broken = insertJob( temp.db )
    const next = insertJob( temp.db )

    startWorker( ( job ) => job.id === broken.id ? Promise.reject( new Error( 'kaboom' ) ) : Promise.resolve( succeeded ) )
    await settle()

    expect( readJob( temp.db, broken.id ) ).toMatchObject( { status: 'failed', attempts: 1, error: 'kaboom' } )
    expect( readJob( temp.db, next.id ).status ).toBe( 'succeeded' )
    expect( logged ).toHaveBeenCalledWith( { err: expect.objectContaining( { message: 'kaboom' } ) }, 'step threw' )

    logged.mockRestore()
  } )

  it( 'discards the result of a job whose lease was swept meanwhile', async () => {
    const job = insertJob( temp.db )
    const gate = defer()

    startWorker( ( claimed, signal ) => claimed.attempts === 1 ? gate.promise : untilAborted( signal ) )
    await settle()
    await vi.advanceTimersByTimeAsync( leaseMs )

    expect( readJob( temp.db, job.id ).status ).not.toBe( 'succeeded' )

    gate.resolve( succeeded )
    await settle()

    expect( eventTypes() ).not.toContain( 'JobCompleted' )
    expect( readJob( temp.db, job.id ).result ).toBeNull()
  } )
} )

describe( 'completion with apply', () => {
  function addMarker( job: JobRow ): StepOutcome {
    return {
      ok: true,
      result: { done: true },
      apply: ( tx, events ) => {
        tx.insert( messages ).values( { project_id: job.project_id, thread: 'pm', author: 'pm', kind: 'chat', content: 'Hi', job_id: job.id } ).run()
        events.push( appendEvent( tx, { project_id: job.project_id, type: 'MessageCompleted', actor: 'pm', payload: { message_id: 1 } } ) )
      },
    }
  }

  function messageCount(): number {
    return ( temp.db.$client.prepare( 'SELECT COUNT(*) AS count FROM messages' ).get() as { count: number } ).count
  }

  it( 'runs apply in the same transaction as the fenced finish', async () => {
    const job = insertJob( temp.db )

    startWorker( ( claimed ) => Promise.resolve( addMarker( claimed ) ) )
    await settle()

    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'succeeded', result: { done: true } } )
    expect( messageCount() ).toBe( 1 )
    expect( eventTypes() ).toEqual( [ 'JobClaimed', 'MessageCompleted', 'JobCompleted' ] )
  } )

  it( 'runs apply for nothing when the lease was swept meanwhile', async () => {
    const job = insertJob( temp.db )
    const gate = defer()

    startWorker( ( claimed, signal ) => claimed.attempts === 1 ? gate.promise : untilAborted( signal ) )
    await settle()
    await vi.advanceTimersByTimeAsync( leaseMs )

    const apply = vi.fn()

    gate.resolve( { ok: true, result: {}, apply } )
    await settle()

    expect( apply ).not.toHaveBeenCalled()
    expect( readJob( temp.db, job.id ).result ).toBeNull()
  } )

  it( 'fails the job as non-retryable "completion failed: <message>", logs it and writes nothing, when apply throws', async () => {
    const logged = vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    const broken = insertJob( temp.db )
    const next = insertJob( temp.db )

    startWorker( ( claimed ) => {
      if( claimed.id !== broken.id ) {
        return Promise.resolve( succeeded )
      }

      return Promise.resolve( {
        ok: true,
        result: { done: true },
        apply: ( tx, events ) => {
          tx.insert( messages ).values( { project_id: claimed.project_id, thread: 'pm', author: 'pm', kind: 'chat', content: 'Half', job_id: claimed.id } ).run()
          events.push( appendEvent( tx, { project_id: claimed.project_id, type: 'MessageCompleted', actor: 'pm', payload: { message_id: 1 } } ) )
          throw new Error( 'disk full' )
        },
      } )
    } )
    await settle()

    expect( readJob( temp.db, broken.id ) ).toMatchObject( { status: 'failed', attempts: 1, error: 'completion failed: disk full', result: null } )
    expect( messageCount() ).toBe( 0 )
    expect( eventTypes() ).toEqual( [ 'JobClaimed', 'JobFailed', 'JobClaimed', 'JobCompleted' ] )
    expect( logged ).toHaveBeenCalledWith( { err: expect.objectContaining( { message: 'disk full' } ) }, 'completion failed' )
    expect( readJob( temp.db, next.id ).status ).toBe( 'succeeded' )

    logged.mockRestore()
  } )
} )

describe( 'fallback tick', () => {
  it( 'is every 5 seconds', () => {
    expect( fallbackTickMs ).toBe( 5_000 )
  } )

  it( 'claims a job whose run_after arrives, with no bus event', async () => {
    const job = insertJob( temp.db, { run_after: 1_000_000 + 12_000 } )
    const step = vi.fn( () => Promise.resolve( succeeded ) )

    startWorker( step )
    await settle()
    await vi.advanceTimersByTimeAsync( 10_000 )

    expect( step ).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync( fallbackTickMs )

    expect( step ).toHaveBeenCalledOnce()
    expect( readJob( temp.db, job.id ).status ).toBe( 'succeeded' )
  } )

  it( 'stops ticking after stop', async () => {
    const job = insertJob( temp.db, { run_after: 1_000_000 + 12_000 } )

    const running = startWorker( () => Promise.resolve( succeeded ) )
    await settle()
    await running.stop()
    await vi.advanceTimersByTimeAsync( 30_000 )

    expect( readJob( temp.db, job.id ).status ).toBe( 'queued' )
  } )
} )

describe( 'lease sweep', () => {
  it( 'runs every 60 seconds and re-queues an expired lease it finds', async () => {
    const orphan = insertJob( temp.db, { status: 'running', attempts: 1, locked_at: 1, lease_expires_at: 1_000_000 + 30_000 } )
    const step = vi.fn( () => Promise.resolve( succeeded ) )

    startWorker( step )
    await settle()

    expect( readJob( temp.db, orphan.id ).status ).toBe( 'running' )
    expect( sweepIntervalMs ).toBe( 60_000 )

    await vi.advanceTimersByTimeAsync( sweepIntervalMs )

    expect( step ).toHaveBeenCalledOnce()
    expect( readJob( temp.db, orphan.id ) ).toMatchObject( { status: 'succeeded', attempts: 2 } )
  } )

  it( 'does not abort the call in flight when its lease expires', async () => {
    insertJob( temp.db )
    const gate = defer()
    let signal: AbortSignal | undefined

    startWorker( ( _job, stepSignal ) => {
      signal = stepSignal

      return gate.promise
    } )
    await settle()
    await vi.advanceTimersByTimeAsync( leaseMs + sweepIntervalMs )

    expect( signal?.aborted ).toBe( false )

    gate.resolve( succeeded )
  } )
} )

describe( 'stop (SIGTERM)', () => {
  it( 'unsubscribes from the bus and stops the sweep', async () => {
    const orphan = insertJob( temp.db, { status: 'running', attempts: 1, lease_expires_at: 1_000_000 + 30_000 } )

    const running = startWorker( () => Promise.resolve( succeeded ) )
    await settle()
    await running.stop()

    expect( bus.listenerCount() ).toBe( 0 )

    await vi.advanceTimersByTimeAsync( sweepIntervalMs * 2 )

    expect( readJob( temp.db, orphan.id ).status ).toBe( 'running' )
  } )

  it( 'claims nothing more after stop, even on a bus event', async () => {
    const running = startWorker( () => Promise.resolve( succeeded ) )
    await settle()
    await running.stop()

    const job = insertJob( temp.db )
    bus.publish( anyEvent )
    await settle()

    expect( readJob( temp.db, job.id ).status ).toBe( 'queued' )
  } )

  it( 'aborts the call in flight, waits for it, and leaves the job running for boot recovery', async () => {
    const job = insertJob( temp.db )
    let signal: AbortSignal | undefined

    const running = startWorker( ( _job, stepSignal ) => {
      signal = stepSignal

      return new Promise< StepOutcome >( ( resolve ) => {
        stepSignal.addEventListener( 'abort', () => resolve( { ok: false, error: 'aborted', retryable: true } ) )
      } )
    } )
    await settle()

    await running.stop()

    expect( signal?.aborted ).toBe( true )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'running', attempts: 1 } )
    expect( eventTypes() ).toEqual( [ 'JobClaimed' ] )
  } )

  it( 'does not start the next queued job once stopping', async () => {
    const first = insertJob( temp.db )
    const second = insertJob( temp.db )
    const gate = defer()
    const started: number[] = []

    const running = startWorker( ( job ) => {
      started.push( job.id )

      return gate.promise
    } )
    await settle()

    const stopping = running.stop()
    gate.resolve( succeeded )
    await stopping

    expect( started ).toEqual( [ first.id ] )
    expect( readJob( temp.db, second.id ).status ).toBe( 'queued' )
  } )
} )
