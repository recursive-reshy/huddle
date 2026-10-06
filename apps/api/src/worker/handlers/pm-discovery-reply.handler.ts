// Packages
import { z } from 'zod'
// Shared
import { jobKindOutputType, type StepRequest } from '@huddle/shared'
// Config
import { models } from '#src/config.js'
// DB
import type { Db } from '#src/db/connection.js'
import type { JobRow } from '#src/db/schema.js'
// Services
import { recordAgentReply } from '#src/services/messages.service.js'
// Worker
import { buildDiscoveryReplyContext } from '../context-builder.js'
import type { StepOutcome } from '../worker.js'

export interface PmDiscoveryReplyDeps {
  db: Db
  call( input: { job: JobRow, request: StepRequest, signal: AbortSignal } ): Promise< StepOutcome >
}

const resultLine = z.object( { output: z.looseObject( { output_type: z.string() } ), prompt_hash: z.string() } )
const chatReply = z.object( { content: z.string().min( 1 ) } )

export function createPmDiscoveryReplyHandler( { db, call }: PmDiscoveryReplyDeps ): ( job: JobRow, signal: AbortSignal ) => Promise< StepOutcome > {
  return async ( job, signal ) => {
    const request: StepRequest = {
      job_id: job.id,
      attempt: job.attempts,
      kind: job.kind,
      agent: job.agent,
      model: models[ job.kind ],
      context: buildDiscoveryReplyContext( db, job ),
    }

    const outcome = await call( { job, request, signal } )

    if( !outcome.ok ) {
      return outcome
    }

    const { output, prompt_hash } = resultLine.parse( outcome.result )
    const expected = jobKindOutputType[ job.kind ]

    if( output.output_type !== expected ) {
      return { ok: false, error: `output_type mismatch: expected ${ expected }, got ${ output.output_type }`, retryable: false }
    }

    const { content } = chatReply.parse( output )

    return {
      ok: true,
      result: { output, prompt_hash },
      apply: ( tx, events ) => {
        recordAgentReply( tx, events, { job, content } )
      },
    }
  }
}
