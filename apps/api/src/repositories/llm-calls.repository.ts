// DB
import type { Tx } from '#src/db/transaction.js'
import { llm_calls, type LlmCallRow } from '#src/db/schema.js'

export type NewLlmCall = Omit< LlmCallRow, 'id' | 'created_at' >

export function insertLlmCall( tx: Tx, call: NewLlmCall ): LlmCallRow {
  return tx.insert( llm_calls ).values( call ).returning().get()
}
