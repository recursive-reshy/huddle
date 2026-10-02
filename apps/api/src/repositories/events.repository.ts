// Packages
import { asc, gt } from 'drizzle-orm'
// DB
import type { Db } from '#src/db/connection.js'
import type { Tx } from '#src/db/transaction.js'
import { events, type EventRow, type EventType } from '#src/db/schema.js'

export interface NewEvent {
  project_id: string
  type: EventType
  actor?: string | null
  payload: Record< string, unknown >
}

export function appendEvent( tx: Tx, { project_id, type, actor, payload }: NewEvent ): EventRow {
  return tx.insert( events ).values( { project_id, type, actor: actor ?? null, payload } ).returning().get()
}

export function listEventsAfter( db: Db, afterId: number ): EventRow[] {
  return db.select().from( events ).where( gt( events.id, afterId ) ).orderBy( asc( events.id ) ).all()
}
