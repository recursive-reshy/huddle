// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import type { EventRow } from '#src/db/schema.js'
// Services
import { claimJob, completeJob, recoverOrphanedJobs, reportJobFailure, sweepExpiredLeases } from './jobs.service.js'
// Test support
import { insertJob, readJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

const leaseMs = 900_000

let temp: TempDatabase
let bus: Bus
let published: EventRow[]

function storedEvents(): { type: string, actor: string | null, payload: string }[] {
  return temp.db.$client.prepare( 'SELECT type, actor, payload FROM events ORDER BY id' ).all() as { type: string, actor: string | null, payload: string }[]
}

beforeEach( () => {
  temp = createTempDatabase()
  bus = createBus()
  published = []
  bus.subscribe( ( event ) => published.push( event ) )
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'claimJob', () => {
  it( 'claims the next job and writes JobClaimed in the same transaction, published after commit', () => {
    const job = insertJob( temp.db )
    const seenInTransaction: boolean[] = []
    bus.subscribe( () => seenInTransaction.push( temp.db.$client.inTransaction ) )

    const claimed = claimJob( temp.db, bus, 1_000, leaseMs )

    expect( claimed ).toMatchObject( { id: job.id, status: 'running', attempts: 1, lease_expires_at: 1_000 + leaseMs } )
    expect( storedEvents() ).toEqual( [ { type: 'JobClaimed', actor: 'pm', payload: JSON.stringify( { job_id: job.id, attempt: 1 } ) } ] )
    expect( published.map( ( event ) => event.type ) ).toEqual( [ 'JobClaimed' ] )
    expect( seenInTransaction ).toEqual( [ false ] )
  } )

  it( 'returns undefined and writes no event when nothing is ready', () => {
    expect( claimJob( temp.db, bus, 1_000, leaseMs ) ).toBeUndefined()
    expect( storedEvents() ).toEqual( [] )
    expect( published ).toEqual( [] )
  } )

  it( 'counts a new attempt each time a job is claimed again', () => {
    const job = insertJob( temp.db )
    const first = claimJob( temp.db, bus, 1_000, leaseMs )!

    reportJobFailure( temp.db, bus, { job: first, error: 'timeout', retryable: true, now: 2_000 } )

    expect( claimJob( temp.db, bus, 12_000, leaseMs ) ).toMatchObject( { id: job.id, attempts: 2 } )
  } )
} )

describe( 'completeJob', () => {
  it( 'finishes the job and writes JobCompleted, published after commit', () => {
    insertJob( temp.db )
    const job = claimJob( temp.db, bus, 1_000, leaseMs )!
    published.length = 0

    const done = completeJob( temp.db, bus, { job, result: { output_type: 'x' }, now: 2_000 } )

    expect( done ).toBe( true )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'succeeded', result: { output_type: 'x' }, lease_expires_at: null, finished_at: 2_000 } )
    expect( storedEvents().at( -1 ) ).toEqual( { type: 'JobCompleted', actor: 'pm', payload: JSON.stringify( { job_id: job.id } ) } )
    expect( published.map( ( event ) => event.type ) ).toEqual( [ 'JobCompleted' ] )
  } )

  it( 'discards a stale result: no write, no event', () => {
    insertJob( temp.db )
    const job = claimJob( temp.db, bus, 1_000, leaseMs )!
    sweepExpiredLeases( temp.db, bus, 1_000 + leaseMs )
    const before = storedEvents().length
    published.length = 0

    const done = completeJob( temp.db, bus, { job, result: {}, now: 2_000_000 } )

    expect( done ).toBe( false )
    expect( readJob( temp.db, job.id ).status ).toBe( 'queued' )
    expect( storedEvents() ).toHaveLength( before )
    expect( published ).toEqual( [] )
  } )
} )

describe( 'reportJobFailure', () => {
  it( 'fails a non-retryable job with its error and writes JobFailed', () => {
    insertJob( temp.db )
    const job = claimJob( temp.db, bus, 1_000, leaseMs )!
    published.length = 0

    const outcome = reportJobFailure( temp.db, bus, { job, error: 'bad output', retryable: false, now: 2_000 } )

    expect( outcome ).toBe( 'failed' )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'failed', error: 'bad output', lease_expires_at: null, finished_at: 2_000 } )
    expect( storedEvents().at( -1 ) ).toEqual( { type: 'JobFailed', actor: 'pm', payload: JSON.stringify( { job_id: job.id, error: 'bad output' } ) } )
    expect( published.map( ( event ) => event.type ) ).toEqual( [ 'JobFailed' ] )
  } )

  it( 're-queues a retryable job within max_attempts, clearing lease and locked_at, with no event', () => {
    insertJob( temp.db )
    const job = claimJob( temp.db, bus, 1_000, leaseMs )!
    const before = storedEvents().length
    published.length = 0

    const outcome = reportJobFailure( temp.db, bus, { job, error: 'timeout', retryable: true, now: 2_000 } )

    expect( outcome ).toBe( 'requeued' )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'queued', attempts: 1, locked_at: null, lease_expires_at: null, finished_at: null } )
    expect( storedEvents() ).toHaveLength( before )
    expect( published ).toEqual( [] )
  } )

  it( 'backs off a retry: run_after = now + 10 s x attempts', () => {
    insertJob( temp.db )
    const first = claimJob( temp.db, bus, 1_000, leaseMs )!

    reportJobFailure( temp.db, bus, { job: first, error: 'timeout', retryable: true, now: 2_000 } )

    expect( readJob( temp.db, first.id ).run_after ).toBe( 2_000 + 10_000 )
    expect( claimJob( temp.db, bus, 11_999, leaseMs ) ).toBeUndefined()

    const second = claimJob( temp.db, bus, 12_000, leaseMs )!

    reportJobFailure( temp.db, bus, { job: second, error: 'timeout', retryable: true, now: 13_000 } )

    expect( readJob( temp.db, second.id ).run_after ).toBe( 13_000 + 20_000 )
  } )

  it( 'fails a retryable job once max_attempts is reached', () => {
    insertJob( temp.db, { attempts: 2, max_attempts: 3 } )
    const job = claimJob( temp.db, bus, 1_000, leaseMs )!

    expect( job.attempts ).toBe( 3 )
    expect( reportJobFailure( temp.db, bus, { job, error: 'timeout', retryable: true, now: 2_000 } ) ).toBe( 'failed' )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'failed', error: 'timeout' } )
  } )

  it( 'discards a stale failure', () => {
    insertJob( temp.db )
    const job = claimJob( temp.db, bus, 1_000, leaseMs )!
    sweepExpiredLeases( temp.db, bus, 1_000 + leaseMs )

    expect( reportJobFailure( temp.db, bus, { job, error: 'late', retryable: false, now: 2_000_000 } ) ).toBe( 'stale' )
    expect( readJob( temp.db, job.id ).status ).toBe( 'queued' )
  } )
} )

describe( 'recoverOrphanedJobs (boot)', () => {
  it( 're-queues running jobs even with a valid lease, and fails exhausted ones with a JobFailed event', () => {
    const orphan = insertJob( temp.db, { status: 'running', attempts: 1, locked_at: 10, lease_expires_at: 999_999_999 } )
    const exhausted = insertJob( temp.db, { status: 'running', attempts: 3, locked_at: 10, lease_expires_at: 999_999_999 } )
    const waiting = insertJob( temp.db )

    const summary = recoverOrphanedJobs( temp.db, bus, 100 )

    expect( summary ).toEqual( { requeued: 1, failed: 1 } )
    expect( readJob( temp.db, orphan.id ) ).toMatchObject( { status: 'queued', attempts: 1, locked_at: null, lease_expires_at: null, finished_at: null } )
    expect( readJob( temp.db, exhausted.id ) ).toMatchObject( { status: 'failed', error: 'orphaned at boot', lease_expires_at: null, finished_at: 100 } )
    expect( readJob( temp.db, waiting.id ).status ).toBe( 'queued' )
    expect( storedEvents() ).toEqual( [ { type: 'JobFailed', actor: 'pm', payload: JSON.stringify( { job_id: exhausted.id, error: 'orphaned at boot' } ) } ] )
    expect( published.map( ( event ) => event.type ) ).toEqual( [ 'JobFailed' ] )
  } )

  it( 'sets run_after to now on every re-queued job', () => {
    const orphan = insertJob( temp.db, { status: 'running', attempts: 2, lease_expires_at: 999_999_999, run_after: 5 } )

    recoverOrphanedJobs( temp.db, bus, 100 )

    expect( readJob( temp.db, orphan.id ).run_after ).toBe( 100 )
  } )

  it( 'does nothing when no job is running', () => {
    insertJob( temp.db )

    expect( recoverOrphanedJobs( temp.db, bus, 100 ) ).toEqual( { requeued: 0, failed: 0 } )
  } )
} )

describe( 'sweepExpiredLeases', () => {
  it( 're-queues expired running jobs and fails exhausted ones', () => {
    const expired = insertJob( temp.db, { status: 'running', attempts: 1, lease_expires_at: 100 } )
    const exhausted = insertJob( temp.db, { status: 'running', attempts: 3, lease_expires_at: 100 } )

    const summary = sweepExpiredLeases( temp.db, bus, 100 )

    expect( summary ).toEqual( { requeued: 1, failed: 1 } )
    expect( readJob( temp.db, expired.id ).status ).toBe( 'queued' )
    expect( readJob( temp.db, exhausted.id ) ).toMatchObject( { status: 'failed', error: 'lease expired' } )
    expect( published.map( ( event ) => event.type ) ).toEqual( [ 'JobFailed' ] )
  } )

  it( 'sets run_after to now on a re-queued job', () => {
    const expired = insertJob( temp.db, { status: 'running', attempts: 2, lease_expires_at: 100, run_after: 5 } )

    sweepExpiredLeases( temp.db, bus, 100 )

    expect( readJob( temp.db, expired.id ).run_after ).toBe( 100 )
  } )

  it( 'leaves jobs with a live lease alone', () => {
    const live = insertJob( temp.db, { status: 'running', attempts: 1, lease_expires_at: 101 } )

    expect( sweepExpiredLeases( temp.db, bus, 100 ) ).toEqual( { requeued: 0, failed: 0 } )
    expect( readJob( temp.db, live.id ).status ).toBe( 'running' )
  } )

  it( 'rolls back and publishes nothing when a write fails', () => {
    const requeued = insertJob( temp.db, { status: 'running', attempts: 1, lease_expires_at: 100 } )
    insertJob( temp.db, { status: 'running', attempts: 3, lease_expires_at: 100 } )
    temp.db.$client.exec( 'CREATE TRIGGER fail_job_events BEFORE INSERT ON events WHEN NEW.type = \'JobFailed\' BEGIN SELECT RAISE( ABORT, \'nope\' ); END' )

    expect( () => sweepExpiredLeases( temp.db, bus, 100 ) ).toThrow( 'nope' )
    expect( published ).toEqual( [] )
    expect( readJob( temp.db, requeued.id ).status ).toBe( 'running' )
  } )
} )
