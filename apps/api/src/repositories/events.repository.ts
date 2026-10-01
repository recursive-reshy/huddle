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

export function appendEvent( handle: Db | Tx, { project_id, type, actor, payload }: NewEvent ): EventRow {
  return handle.insert( events ).values( { project_id, type, actor: actor ?? null, payload } ).returning().get()
}
