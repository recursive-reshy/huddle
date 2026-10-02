// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from '#src/db/connection.js'
// Logger
import { logger } from '#src/logger.js'
// Services
import { recoverOrphanedJobs, type RecoverySummary } from '#src/services/jobs.service.js'

export function recoverAtBoot( db: Db, bus: Bus, now: number ): RecoverySummary {
  const summary = recoverOrphanedJobs( db, bus, now )

  if( summary.requeued > 0 || summary.failed > 0 ) {
    logger.info( summary, 'boot recovery' )
  }

  return summary
}
