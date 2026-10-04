// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// DB
import { writeTransaction } from '#src/db/transaction.js'
// Bus
import { createBus } from '#src/bus/bus.js'
// Repositories
import { insertLlmCall } from './llm-calls.repository.js'
// Test support
import { insertJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

let temp: TempDatabase

beforeEach( () => {
  temp = createTempDatabase()
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'insertLlmCall', () => {
  it( 'inserts the row and returns it with its id and created_at', () => {
    const job = insertJob( temp.db )
    const call = { project_id: job.project_id, job_id: job.id, agent: 'pm', model: 'claude-sonnet-5-5', input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4, cost_micro_usd: 5 }

    const row = writeTransaction( temp.db, createBus(), ( tx ) => insertLlmCall( tx, call ) )

    expect( row ).toMatchObject( call )
    expect( row.id ).toBeGreaterThan( 0 )
    expect( row.created_at ).toBeGreaterThan( 0 )
    expect( temp.db.$client.prepare( 'SELECT COUNT(*) AS count FROM llm_calls' ).get() ).toEqual( { count: 1 } )
  } )
} )
