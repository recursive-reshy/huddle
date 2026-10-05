// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from '#src/db/connection.js'
import type { EventRow, JobRow } from '#src/db/schema.js'
import { writeTransaction, type Tx } from '#src/db/transaction.js'
// Repositories
import { appendEvent } from '#src/repositories/events.repository.js'
import { claimNextJob, failJob, finishJob, listExpiredJobs, listRunningJobs, requeueJob } from '#src/repositories/jobs.repository.js'

export type ApplyResult = ( tx: Tx, events: EventRow[] ) => void

const retryBackoffMs = 10_000

export interface RecoverySummary {
  requeued: number
  failed: number
}

function failedEvent( tx: Tx, job: JobRow, error: string ): ReturnType< typeof appendEvent > {
  return appendEvent( tx, { project_id: job.project_id, type: 'JobFailed', actor: job.agent, payload: { job_id: job.id, error } } )
}

export function claimJob( db: Db, bus: Bus, now: number, leaseMs: number ): JobRow | undefined {
  return writeTransaction( db, bus, ( tx, events ) => {
    const job = claimNextJob( tx, now, leaseMs )

    if( !job ) {
      return undefined
    }

    events.push( appendEvent( tx, { project_id: job.project_id, type: 'JobClaimed', actor: job.agent, payload: { job_id: job.id, attempt: job.attempts } } ) )

    return job
  } )
}

export function completeJob( db: Db, bus: Bus, { job, result, now, apply }: { job: JobRow, result: Record< string, unknown >, now: number, apply?: ApplyResult } ): boolean {
  return writeTransaction( db, bus, ( tx, events ) => {
    if( !finishJob( tx, { id: job.id, attempts: job.attempts, result, now } ) ) {
      return false
    }

    apply?.( tx, events )

    events.push( appendEvent( tx, { project_id: job.project_id, type: 'JobCompleted', actor: job.agent, payload: { job_id: job.id } } ) )

    return true
  } )
}

export function reportJobFailure( db: Db, bus: Bus, { job, error, retryable, now }: { job: JobRow, error: string, retryable: boolean, now: number } ): 'failed' | 'requeued' | 'stale' {
  return writeTransaction( db, bus, ( tx, events ) => {
    if( retryable && job.attempts < job.max_attempts ) {
      return requeueJob( tx, { id: job.id, attempts: job.attempts, run_after: now + retryBackoffMs * job.attempts } ) ? 'requeued' : 'stale'
    }

    if( !failJob( tx, { id: job.id, attempts: job.attempts, error, now } ) ) {
      return 'stale'
    }

    events.push( failedEvent( tx, job, error ) )

    return 'failed'
  } )
}

function recover( db: Db, bus: Bus, list: ( tx: Tx ) => JobRow[], error: string, now: number ): RecoverySummary {
  return writeTransaction( db, bus, ( tx, events ) => {
    const summary: RecoverySummary = { requeued: 0, failed: 0 }

    for( const job of list( tx ) ) {
      if( job.attempts < job.max_attempts ) {
        if( requeueJob( tx, { id: job.id, attempts: job.attempts, run_after: now } ) ) {
          summary.requeued += 1
        }

        continue
      }

      if( failJob( tx, { id: job.id, attempts: job.attempts, error, now } ) ) {
        events.push( failedEvent( tx, job, error ) )
        summary.failed += 1
      }
    }

    return summary
  } )
}

export function recoverOrphanedJobs( db: Db, bus: Bus, now: number ): RecoverySummary {
  return recover( db, bus, listRunningJobs, 'orphaned at boot', now )
}

export function sweepExpiredLeases( db: Db, bus: Bus, now: number ): RecoverySummary {
  return recover( db, bus, ( tx ) => listExpiredJobs( tx, now ), 'lease expired', now )
}
