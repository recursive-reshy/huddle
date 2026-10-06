// Shared
import type { JobKind } from '@huddle/shared'
// DB
import type { JobRow } from '#src/db/schema.js'
// Worker
import type { StepOutcome } from './worker.js'

export type Handler = ( job: JobRow, signal: AbortSignal ) => Promise< StepOutcome >

export function createDispatcher( handlers: Partial< Record< JobKind, Handler > > ): Handler {
  return ( job, signal ) => {
    const handler = handlers[ job.kind ]

    if( !handler ) {
      return Promise.resolve( { ok: false, error: `no handler for ${ job.kind }`, retryable: false } )
    }

    return handler( job, signal )
  }
}
