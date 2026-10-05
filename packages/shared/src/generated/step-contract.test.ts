// Node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Packages
import { describe, expect, it } from 'vitest'
// Shared
import { stepLine, stepRequest } from './step-contract.js'
import { renderStepContract } from '../../scripts/render.js'

const schemaPath = fileURLToPath( new URL( '../../../../services/agents/schema/step_contract.json', import.meta.url ) )
const generatedPath = fileURLToPath( new URL( './step-contract.ts', import.meta.url ) )
const hash = 'a'.repeat( 64 )

describe( 'generated step contract', () => {
  it( 'is identical to a fresh generation from services/agents/schema/step_contract.json (drift test)', () => {
    const fresh = renderStepContract( JSON.parse( readFileSync( schemaPath, 'utf8' ) ) )

    expect( readFileSync( generatedPath, 'utf8' ) ).toBe( fresh )
  } )

  it( 'generates the same text twice', () => {
    const schema: unknown = JSON.parse( readFileSync( schemaPath, 'utf8' ) )

    expect( renderStepContract( schema ) ).toBe( renderStepContract( schema ) )
  } )

  it( 'throws on a $ref that is not in $defs', () => {
    expect( () => renderStepContract( { $defs: { StepLine: { $ref: '#/$defs/Missing' }, StepRequest: {} } } ) ).toThrow( /Missing/ )
  } )

  it( 'throws on a circular $ref', () => {
    expect( () => renderStepContract( { $defs: { StepLine: { $ref: '#/$defs/A' }, StepRequest: {}, A: { $ref: '#/$defs/StepLine' } } } ) ).toThrow( /circular/ )
  } )
} )

describe( 'stepLine', () => {
  it.each( [
    [ 'delta', { type: 'delta', text: 'Hel' } ],
    [ 'usage', { type: 'usage', model: 'fake', input_tokens: 1, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 } ],
    [ 'result', { type: 'result', prompt_hash: hash, output: { output_type: 'chat_reply', content: 'Hello' } } ],
    [ 'error', { type: 'error', code: 'overloaded', message: 'busy', retryable: true } ],
  ] )( 'accepts a %s line', ( _name, line ) => {
    expect( stepLine.parse( line ) ).toEqual( line )
  } )

  it( 'rejects an unknown line type', () => {
    expect( stepLine.safeParse( { type: 'banana' } ).success ).toBe( false )
  } )

  it( 'rejects a line with an undeclared field', () => {
    expect( stepLine.safeParse( { type: 'delta', text: 'x', extra: 1 } ).success ).toBe( false )
  } )

  it( 'rejects an empty delta', () => {
    expect( stepLine.safeParse( { type: 'delta', text: '' } ).success ).toBe( false )
  } )

  it( 'rejects negative token counts', () => {
    expect( stepLine.safeParse( { type: 'usage', model: 'fake', input_tokens: -1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } ).success ).toBe( false )
  } )

  it( 'rejects a malformed prompt hash', () => {
    expect( stepLine.safeParse( { type: 'result', prompt_hash: 'xyz', output: { output_type: 'chat_reply', content: 'Hello' } } ).success ).toBe( false )
  } )

  it( 'rejects an empty chat reply', () => {
    expect( stepLine.safeParse( { type: 'result', prompt_hash: hash, output: { output_type: 'chat_reply', content: '' } } ).success ).toBe( false )
  } )

  it( 'rejects an unknown error code', () => {
    expect( stepLine.safeParse( { type: 'error', code: 'nope', message: 'm', retryable: false } ).success ).toBe( false )
  } )

  it( 'accepts a heartbeat line that carries nothing', () => {
    expect( stepLine.parse( { type: 'heartbeat' } ) ).toEqual( { type: 'heartbeat' } )
    expect( stepLine.safeParse( { type: 'heartbeat', extra: 1 } ).success ).toBe( false )
  } )

  // Waits on the Lead Dev (Agents): step_contract.json only has the chat_reply output (TRD v1.8 §6 lists five).
  it.todo( 'accepts result lines for draft_artifact, review, clarification and summary' )
} )

describe( 'stepRequest', () => {
  const context = {
    project: { id: 'p1', name: 'Huddle' },
    artifacts: [],
    decisions: [],
    draft: [],
    questions: [],
    messages: [ { author: 'human', kind: 'chat', content: 'Hi' } ],
    task: { notes: '', mode: 'normal', may_ask: false },
  }
  const request = { job_id: 1, attempt: 1, kind: 'pm_discovery_reply', agent: 'pm', model: 'fake', context }

  it( 'accepts a request', () => {
    expect( stepRequest.parse( request ) ).toEqual( request )
  } )

  it( 'rejects attempt 0', () => {
    expect( stepRequest.safeParse( { ...request, attempt: 0 } ).success ).toBe( false )
  } )

  it( 'rejects a context with a missing field', () => {
    const withoutMessages = Object.fromEntries( Object.entries( context ).filter( ( [ key ] ) => key !== 'messages' ) )

    expect( stepRequest.safeParse( { ...request, context: withoutMessages } ).success ).toBe( false )
  } )

  it( 'carries task.may_ask', () => {
    const withoutMayAsk = { ...request, context: { ...context, task: { notes: '', mode: 'normal' } } }

    expect( stepRequest.safeParse( withoutMayAsk ).success ).toBe( false )
  } )

  it( 'rejects task.may_ask: null', () => {
    const nullMayAsk = { ...request, context: { ...context, task: { notes: '', mode: 'normal', may_ask: null } } }

    expect( stepRequest.safeParse( nullMayAsk ).success ).toBe( false )
  } )
} )
