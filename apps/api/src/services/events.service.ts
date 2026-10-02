// DB
import type { Db } from '#src/db/connection.js'
import type { EventRow } from '#src/db/schema.js'
// Repositories
import { listEventsAfter } from '#src/repositories/events.repository.js'

export function replayEvents( db: Db, afterId: number ): EventRow[] {
  return listEventsAfter( db, afterId )
}
