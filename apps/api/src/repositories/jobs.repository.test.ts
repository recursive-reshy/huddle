// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Bus
import { createBus } from '#src/bus/bus.js'
// DB
import { writeTransaction, type Tx } from '#src/db/transaction.js'
// Repositories
import { claimNextJob, enqueueJob, failJob, finishJob, hasReplyInFlight, listExpiredJobs, listRunningJobs, requeueJob } from './jobs.repository.js'
// Test support
import { insertJob, insertProject, readJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

const leaseMs = 900_000

let temp: TempDatabase

function inTransaction< T >( callback: ( tx: Tx ) => T ): T {
  return writeTransaction( temp.db, createBus(), ( tx ) => callback( tx ) )
}

beforeEach( () => {
  temp = createTempDatabase()
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'claimNextJob', () => {
  it( 'claims the oldest ready job, counts the attempt and sets the lease together', () => {
    const later = insertJob( temp.db, { run_after: 20 } )
    const first = insertJob( temp.db, { run_after: 10 } )

    const claimed = inTransaction( ( tx ) => claimNextJob( tx, 1_000, leaseMs ) )

    expect( claimed ).toMatchObject( { id: first.id, status: 'running', attempts: 1, locked_at: 1_000, lease_expires_at: 1_000 + leaseMs, finished_at: null } )
    expect( readJob( temp.db, later.id ).status ).toBe( 'queued' )
  } )

  it( 'breaks run_after ties by id', () => {
    const first = insertJob( temp.db, { run_after: 10 } )
    insertJob( temp.db, { run_after: 10 } )

    expect( inTransaction( ( tx ) => claimNextJob( tx, 1_000, leaseMs ) )?.id ).toBe( first.id )
  } )

  it( 'skips jobs whose run_after is in the future', () => {
    insertJob( temp.db, { run_after: 5_000 } )

    expect( inTransaction( ( tx ) => claimNextJob( tx, 1_000, leaseMs ) ) ).toBeUndefined()
  } )

  it( 'skips jobs that are not queued', () => {
    insertJob( temp.db, { status: 'running', lease_expires_at: 99 } )
    insertJob( temp.db, { status: 'failed', finished_at: 1 } )

    expect( inTransaction( ( tx ) => claimNextJob( tx, 1_000, leaseMs ) ) ).toBeUndefined()
  } )
} )

describe( 'finishJob', () => {
  it( 'marks a running job succeeded, stores the result, clears the lease and sets finished_at', () => {
    const job = insertJob( temp.db, { status: 'running', attempts: 1, locked_at: 1, lease_expires_at: 99 } )

    const changed = inTransaction( ( tx ) => finishJob( tx, { id: job.id, attempts: 1, result: { ok: true }, now: 500 } ) )

    expect( changed ).toBe( true )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'succeeded', result: { ok: true }, lease_expires_at: null, finished_at: 500 } )
  } )

  it( 'changes nothing when the attempt no longer matches (stale)', () => {
    const job = insertJob( temp.db, { status: 'running', attempts: 2, lease_expires_at: 99 } )

    expect( inTransaction( ( tx ) => finishJob( tx, { id: job.id, attempts: 1, result: {}, now: 500 } ) ) ).toBe( false )
    expect( readJob( temp.db, job.id ).status ).toBe( 'running' )
  } )

  it( 'changes nothing when the job is no longer running', () => {
    const job = insertJob( temp.db )

    expect( inTransaction( ( tx ) => finishJob( tx, { id: job.id, attempts: 0, result: {}, now: 500 } ) ) ).toBe( false )
    expect( readJob( temp.db, job.id ).status ).toBe( 'queued' )
  } )
} )

describe( 'failJob', () => {
  it( 'marks a running job failed with its error, clears the lease and sets finished_at', () => {
    const job = insertJob( temp.db, { status: 'running', attempts: 1, lease_expires_at: 99 } )

    const changed = inTransaction( ( tx ) => failJob( tx, { id: job.id, attempts: 1, error: 'bad', now: 500 } ) )

    expect( changed ).toBe( true )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'failed', error: 'bad', lease_expires_at: null, finished_at: 500 } )
  } )

  it( 'changes nothing when stale', () => {
    const job = insertJob( temp.db, { status: 'running', attempts: 2, lease_expires_at: 99 } )

    expect( inTransaction( ( tx ) => failJob( tx, { id: job.id, attempts: 1, error: 'bad', now: 500 } ) ) ).toBe( false )
    expect( readJob( temp.db, job.id ).status ).toBe( 'running' )
  } )
} )

describe( 'requeueJob', () => {
  it( 'returns a running job to queued, clearing the lease and locked_at and leaving finished_at null', () => {
    const job = insertJob( temp.db, { status: 'running', attempts: 1, locked_at: 5, lease_expires_at: 99 } )

    const changed = inTransaction( ( tx ) => requeueJob( tx, { id: job.id, attempts: 1 } ) )

    expect( changed ).toBe( true )
    expect( readJob( temp.db, job.id ) ).toMatchObject( { status: 'queued', attempts: 1, locked_at: null, lease_expires_at: null, finished_at: null } )
  } )

  it( 'sets run_after when one is given', () => {
    const job = insertJob( temp.db, { status: 'running', attempts: 1, lease_expires_at: 99, run_after: 5 } )

    inTransaction( ( tx ) => requeueJob( tx, { id: job.id, attempts: 1, run_after: 12_345 } ) )

    expect( readJob( temp.db, job.id ).run_after ).toBe( 12_345 )
  } )

  it( 'changes nothing when stale', () => {
    const job = insertJob( temp.db, { status: 'running', attempts: 2, lease_expires_at: 99 } )

    expect( inTransaction( ( tx ) => requeueJob( tx, { id: job.id, attempts: 1 } ) ) ).toBe( false )
  } )
} )

describe( 'listing running jobs', () => {
  it( 'lists every running job', () => {
    const running = insertJob( temp.db, { status: 'running', lease_expires_at: 999_999 } )
    insertJob( temp.db )

    expect( inTransaction( ( tx ) => listRunningJobs( tx ) ).map( ( job ) => job.id ) ).toEqual( [ running.id ] )
  } )

  it( 'lists only running jobs whose lease has expired, boundary included', () => {
    const expired = insertJob( temp.db, { status: 'running', lease_expires_at: 100 } )
    const boundary = insertJob( temp.db, { status: 'running', lease_expires_at: 200 } )
    insertJob( temp.db, { status: 'running', lease_expires_at: 201 } )

    expect( inTransaction( ( tx ) => listExpiredJobs( tx, 200 ) ).map( ( job ) => job.id ) ).toEqual( [ expired.id, boundary.id ] )
  } )
} )

describe( 'enqueueJob', () => {
  it( 'inserts a queued job and returns the stored row', () => {
    insertProject( temp.db, 'p1' )

    const job = inTransaction( ( tx ) => enqueueJob( tx, { project_id: 'p1', kind: 'pm_discovery_reply', agent: 'pm', input: { message_id: 4 } } ) )

    expect( job ).toMatchObject( { project_id: 'p1', kind: 'pm_discovery_reply', agent: 'pm', status: 'queued', input: { message_id: 4 }, attempts: 0 } )
    expect( readJob( temp.db, job.id ) ).toEqual( job )
  } )
} )

describe( 'hasReplyInFlight', () => {
  const thread = { project_id: 'p1', agent: 'pm' } as const

  function inFlight( overrides: Parameters< typeof insertJob >[ 1 ] ): boolean {
    insertJob( temp.db, overrides )

    return inTransaction( ( tx ) => hasReplyInFlight( tx, thread ) )
  }

  it( 'is false when the project has no jobs', () => {
    insertProject( temp.db, 'p1' )

    expect( inTransaction( ( tx ) => hasReplyInFlight( tx, thread ) ) ).toBe( false )
  } )

  it( 'is true for a queued pm_discovery_reply', () => {
    expect( inFlight( { status: 'queued' } ) ).toBe( true )
  } )

  it( 'is true for a running pm_discovery_reply', () => {
    expect( inFlight( { status: 'running', lease_expires_at: 10 } ) ).toBe( true )
  } )

  it( 'is true for a queued agent_chat_reply on the same agent', () => {
    expect( inFlight( { kind: 'agent_chat_reply', status: 'queued' } ) ).toBe( true )
  } )

  it.each( [
    [ 'succeeded', { status: 'succeeded', finished_at: 10 } ],
    [ 'failed', { status: 'failed', finished_at: 10 } ],
    [ 'cancelled', { status: 'cancelled', finished_at: 10 } ],
  ] as const )( 'is false once the reply is %s', ( _status, overrides ) => {
    expect( inFlight( overrides ) ).toBe( false )
  } )

  it( 'ignores jobs of other kinds', () => {
    expect( inFlight( { kind: 'pm_draft_brief', status: 'queued' } ) ).toBe( false )
  } )

  it( 'ignores another agent on the same project', () => {
    expect( inFlight( { kind: 'agent_chat_reply', agent: 'sa', status: 'queued' } ) ).toBe( false )
  } )

  it( 'ignores another project', () => {
    expect( inFlight( { project_id: 'p2', status: 'queued' } ) ).toBe( false )
  } )
} )
