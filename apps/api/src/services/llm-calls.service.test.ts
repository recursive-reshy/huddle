// Packages
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import type { JobRow, LlmCallRow } from '#src/db/schema.js'
// Logger
import { logger } from '#src/logger.js'
// Services
import { recordLlmCall } from './llm-calls.service.js'
// Test support
import { insertJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

const sonnet = 'claude-sonnet-5-5'
const tokens = { input_tokens: 1_000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0 }

let temp: TempDatabase
let bus: Bus
let job: JobRow

function rows(): LlmCallRow[] {
  return temp.db.$client.prepare( 'SELECT * FROM llm_calls ORDER BY id' ).all() as LlmCallRow[]
}

beforeEach( () => {
  temp = createTempDatabase()
  bus = createBus()
  job = insertJob( temp.db, { agent: 'sa', kind: 'sa_review_brief' } )
} )

afterEach( () => {
  vi.restoreAllMocks()
  temp.cleanup()
} )

describe( 'recordLlmCall', () => {
  it( 'writes a row for the job with the usage and its cost in integer micro-dollars', () => {
    recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: sonnet, ...tokens } } )

    expect( rows() ).toMatchObject( [ { project_id: 'p1', job_id: job.id, agent: 'sa', model: sonnet, ...tokens, cost_micro_usd: 7_000 } ] )
  } )

  it( 'returns the row it wrote', () => {
    const row = recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: sonnet, ...tokens } } )

    expect( row ).toEqual( rows()[ 0 ] )
  } )

  it( 'writes one row per call, so two calls in one job are two rows', () => {
    recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: sonnet, ...tokens } } )
    recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: sonnet, ...tokens } } )

    expect( rows() ).toHaveLength( 2 )
  } )

  it( 'prices fake at 0', () => {
    recordLlmCall( temp.db, bus, { job, requestedModel: 'fake', usage: { model: 'fake', ...tokens } } )

    expect( rows()[ 0 ].cost_micro_usd ).toBe( 0 )
  } )

  it( 'leaves no transaction open and publishes nothing', () => {
    const listener = vi.fn()

    bus.subscribe( listener )
    recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: sonnet, ...tokens } } )

    expect( temp.db.$client.inTransaction ).toBe( false )
    expect( listener ).not.toHaveBeenCalled()
  } )

  describe( 'a model with no price', () => {
    it( 'still writes the row, priced at the requested model, and stores the model string the response returned', () => {
      recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: 'claude-sonnet-5-5-20271201', ...tokens } } )

      expect( rows() ).toMatchObject( [ { model: 'claude-sonnet-5-5-20271201', cost_micro_usd: 7_000 } ] )
    } )

    it( 'calls logger.warn naming both models', () => {
      const warn = vi.spyOn( logger, 'warn' )

      recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: 'claude-sonnet-5-5-20271201', ...tokens } } )

      expect( warn ).toHaveBeenCalledTimes( 1 )
      expect( JSON.stringify( warn.mock.calls[ 0 ] ) ).toContain( 'claude-sonnet-5-5-20271201' )
      expect( JSON.stringify( warn.mock.calls[ 0 ] ) ).toContain( sonnet )
    } )

    it( 'does not warn for a priced model', () => {
      const warn = vi.spyOn( logger, 'warn' )

      recordLlmCall( temp.db, bus, { job, requestedModel: sonnet, usage: { model: sonnet, ...tokens } } )

      expect( warn ).not.toHaveBeenCalled()
    } )
  } )
} )
