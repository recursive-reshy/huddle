// Bus
import type { Bus } from '#src/bus/bus.js'
// Config
import { prices } from '#src/config.js'
// DB
import type { Db } from '#src/db/connection.js'
import type { JobRow, LlmCallRow } from '#src/db/schema.js'
import { writeTransaction } from '#src/db/transaction.js'
// Logger
import { logger } from '#src/logger.js'
// Repositories
import { insertLlmCall } from '#src/repositories/llm-calls.repository.js'
// Services
import { costMicroUsd, type Usage } from './cost.service.js'

export function recordLlmCall( db: Db, bus: Bus, { job, requestedModel, usage }: { job: JobRow, requestedModel: string, usage: Usage } ): LlmCallRow {
  // spend that was billed is never dropped, so a model the price table doesn't know is priced as the model Express asked for
  const priced = Object.hasOwn( prices, usage.model )

  if( !priced ) {
    logger.warn( { model: usage.model, requested_model: requestedModel }, 'no price for model, using the requested model\'s price' )
  }

  const cost_micro_usd = costMicroUsd( priced ? usage : { ...usage, model: requestedModel } )

  return writeTransaction( db, bus, ( tx ) => insertLlmCall( tx, {
    project_id: job.project_id,
    job_id: job.id,
    agent: job.agent,
    model: usage.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_write_tokens: usage.cache_write_tokens,
    cost_micro_usd,
  } ) )
}
