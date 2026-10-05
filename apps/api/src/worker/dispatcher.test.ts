// Packages
import { describe, expect, it, vi } from 'vitest'
// Worker
import { createDispatcher } from './dispatcher.js'
import type { StepOutcome } from './worker.js'
// Test support
import type { JobRow } from '#src/db/schema.js'

function jobOfKind( kind: JobRow[ 'kind' ] ): JobRow {
  return { id: 1, project_id: 'p1', kind, agent: 'pm', status: 'running', input: {}, result: null, error: null, attempts: 1, max_attempts: 3, run_after: 0, locked_at: 0, lease_expires_at: 1, created_at: 0, finished_at: null }
}

describe( 'createDispatcher', () => {
  it( 'runs the handler registered for the job kind, with the job and the signal, and returns its outcome', async () => {
    const outcome: StepOutcome = { ok: true, result: { done: true } }
    const handler = vi.fn( () => Promise.resolve( outcome ) )
    const other = vi.fn()
    const signal = new AbortController().signal
    const job = jobOfKind( 'pm_discovery_reply' )

    const result = await createDispatcher( { pm_discovery_reply: handler, agent_chat_reply: other } )( job, signal )

    expect( result ).toBe( outcome )
    expect( handler ).toHaveBeenCalledWith( job, signal )
    expect( other ).not.toHaveBeenCalled()
  } )

  it( 'fails a kind with no handler as non-retryable "no handler for <kind>"', async () => {
    const result = await createDispatcher( {} )( jobOfKind( 'pm_draft_brief' ), new AbortController().signal )

    expect( result ).toEqual( { ok: false, error: 'no handler for pm_draft_brief', retryable: false } )
  } )
} )
