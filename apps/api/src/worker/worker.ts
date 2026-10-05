// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from '#src/db/connection.js'
import type { JobRow } from '#src/db/schema.js'
// Logger
import { logger } from '#src/logger.js'
// Services
import { claimJob, completeJob, reportJobFailure, sweepExpiredLeases, type ApplyResult } from '#src/services/jobs.service.js'

export const fallbackTickMs = 5_000
export const sweepIntervalMs = 60_000

export type StepOutcome = { ok: true, result: Record< string, unknown >, apply?: ApplyResult } | { ok: false, error: string, retryable: boolean }

export interface Worker {
  start(): void
  stop(): Promise< void >
}

export interface WorkerOptions {
  db: Db
  bus: Bus
  leaseMs: number
  runStep( job: JobRow, signal: AbortSignal ): Promise< StepOutcome >
}

export function createWorker( { db, bus, leaseMs, runStep }: WorkerOptions ): Worker {
  const controller = new AbortController()
  let unsubscribe: ( () => void ) | undefined
  let timer: NodeJS.Timeout | undefined
  let tick: NodeJS.Timeout | undefined
  let stopping = false
  let active = false
  let rerun = false
  let current: Promise< void > = Promise.resolve()

  async function process( job: JobRow ): Promise< void > {
    let outcome: StepOutcome

    try {
      outcome = await runStep( job, controller.signal )
    } catch( error ) {
      logger.error( { err: error }, 'step threw' )
      outcome = { ok: false, error: error instanceof Error ? error.message : String( error ), retryable: false }
    }

    // an aborted call is left running: boot recovery re-queues it
    if( controller.signal.aborted ) {
      return
    }

    if( outcome.ok ) {
      try {
        completeJob( db, bus, { job, result: outcome.result, now: Date.now(), apply: outcome.apply } )
      } catch( error ) {
        // the finish rolled back, so the job is still running: fail it rather than leave it for the lease sweep
        logger.error( { err: error }, 'completion failed' )
        reportJobFailure( db, bus, { job, error: `completion failed: ${ error instanceof Error ? error.message : String( error ) }`, retryable: false, now: Date.now() } )
      }
    } else {
      reportJobFailure( db, bus, { job, error: outcome.error, retryable: outcome.retryable, now: Date.now() } )
    }
  }

  async function drain(): Promise< void > {
    try {
      do {
        rerun = false

        while( !stopping ) {
          const job = claimJob( db, bus, Date.now(), leaseMs )

          if( !job ) {
            break
          }

          await process( job )
        }
      } while( rerun && !stopping )
    } finally {
      active = false
    }
  }

  function wake(): void {
    if( stopping ) {
      return
    }

    if( active ) {
      rerun = true

      return
    }

    active = true
    current = drain().catch( ( error: unknown ) => {
      logger.error( { err: error }, 'worker loop failed' )
    } )
  }

  function sweep(): void {
    try {
      sweepExpiredLeases( db, bus, Date.now() )
    } catch( error ) {
      logger.error( { err: error }, 'lease sweep failed' )
    }

    wake()
  }

  return {
    start(): void {
      unsubscribe = bus.subscribe( wake )
      timer = setInterval( sweep, sweepIntervalMs )
      // run_after has no bus event, so poll for jobs that become ready
      tick = setInterval( wake, fallbackTickMs )
      wake()
    },

    async stop(): Promise< void > {
      stopping = true
      unsubscribe?.()
      clearInterval( timer )
      clearInterval( tick )
      controller.abort()

      await current
    },
  }
}
