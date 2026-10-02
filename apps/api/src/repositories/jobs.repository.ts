// Packages
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
// Shared
import type { JobKind } from '@my-team/shared'
// DB
import type { Tx } from '#src/db/transaction.js'
import { jobs, type JobRow } from '#src/db/schema.js'

export function claimNextJob( tx: Tx, now: number, leaseMs: number ): JobRow | undefined {
  const next = tx.select( { id: jobs.id } ).from( jobs )
    .where( and( eq( jobs.status, 'queued' ), lte( jobs.run_after, now ) ) )
    .orderBy( asc( jobs.run_after ), asc( jobs.id ) )
    .limit( 1 )
    .get()

  if( !next ) {
    return undefined
  }

  return tx.update( jobs )
    .set( { status: 'running', attempts: sql`${jobs.attempts} + 1`, locked_at: now, lease_expires_at: now + leaseMs } )
    .where( and( eq( jobs.id, next.id ), eq( jobs.status, 'queued' ) ) )
    .returning()
    .get()
}

export function finishJob( tx: Tx, { id, attempts, result, now }: { id: number, attempts: number, result: Record< string, unknown >, now: number } ): boolean {
  const { changes } = tx.update( jobs )
    .set( { status: 'succeeded', result, lease_expires_at: null, finished_at: now } )
    .where( and( eq( jobs.id, id ), eq( jobs.status, 'running' ), eq( jobs.attempts, attempts ) ) )
    .run()

  return changes === 1
}

export function failJob( tx: Tx, { id, attempts, error, now }: { id: number, attempts: number, error: string, now: number } ): boolean {
  const { changes } = tx.update( jobs )
    .set( { status: 'failed', error, lease_expires_at: null, finished_at: now } )
    .where( and( eq( jobs.id, id ), eq( jobs.status, 'running' ), eq( jobs.attempts, attempts ) ) )
    .run()

  return changes === 1
}

export function requeueJob( tx: Tx, { id, attempts, run_after }: { id: number, attempts: number, run_after?: number } ): boolean {
  const { changes } = tx.update( jobs )
    .set( { status: 'queued', locked_at: null, lease_expires_at: null, ...( run_after === undefined ? {} : { run_after } ) } )
    .where( and( eq( jobs.id, id ), eq( jobs.status, 'running' ), eq( jobs.attempts, attempts ) ) )
    .run()

  return changes === 1
}

export function listRunningJobs( tx: Tx ): JobRow[] {
  return tx.select().from( jobs ).where( eq( jobs.status, 'running' ) ).orderBy( asc( jobs.id ) ).all()
}

export function listExpiredJobs( tx: Tx, now: number ): JobRow[] {
  return tx.select().from( jobs )
    .where( and( eq( jobs.status, 'running' ), lte( jobs.lease_expires_at, now ) ) )
    .orderBy( asc( jobs.id ) )
    .all()
}

export function enqueueJob( tx: Tx, { project_id, kind, agent, input }: { project_id: string, kind: JobKind, agent: string, input: Record< string, unknown > } ): JobRow {
  return tx.insert( jobs ).values( { project_id, kind, agent, input } ).returning().get()
}

// jobs has no thread column: a thread is named after its agent, so project and agent identify it
export function hasReplyInFlight( tx: Tx, { project_id, agent }: { project_id: string, agent: string } ): boolean {
  const found = tx.select( { id: jobs.id } ).from( jobs )
    .where( and(
      eq( jobs.project_id, project_id ),
      eq( jobs.agent, agent ),
      inArray( jobs.kind, [ 'pm_discovery_reply', 'agent_chat_reply' ] ),
      inArray( jobs.status, [ 'queued', 'running' ] ),
    ) )
    .limit( 1 )
    .get()

  return found !== undefined
}
