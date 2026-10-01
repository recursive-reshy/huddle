// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from '#src/db/connection.js'
// Services
import { recoverOrphanedJobs, type RecoverySummary } from '#src/services/jobs.service.js'

export function recoverAtBoot( db: Db, bus: Bus, now: number ): RecoverySummary {
  const summary = recoverOrphanedJobs( db, bus, now )

  if( summary.requeued > 0 || summary.failed > 0 ) {
    console.log( `boot recovery: re-queued ${ summary.requeued } job(s), failed ${ summary.failed }` )
  }

  return summary
}
