// DB
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
