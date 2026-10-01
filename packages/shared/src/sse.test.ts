// Packages
import { describe, expect, it } from 'vitest'
// Shared
import { deltaEvent, storedEvent } from './sse.js'

const base = { id: 7, project_id: 'p1', actor: 'pm', created_at: 1_700_000_000_000 }

describe( 'storedEvent', () => {
  it.each( [
    [ 'JobClaimed', { job_id: 1, attempt: 1 } ],
    [ 'JobCompleted', { job_id: 1 } ],
    [ 'JobFailed', { job_id: 1, error: 'boom' } ],
    [ 'MessageCompleted', { message_id: 3 } ],
    [ 'StateTransitioned', { from: 'DISCOVERY', to: 'BRIEF_DRAFT', trigger: 'draft_brief', state_rev: 1 } ],
  ] )( 'accepts %s', ( type, payload ) => {
    const event = { ...base, type, payload }

    expect( storedEvent.parse( event ) ).toEqual( event )
  } )

  it( 'accepts a null actor for a system event', () => {
    const event = { ...base, actor: null, type: 'JobCompleted', payload: { job_id: 1 } }

    expect( storedEvent.parse( event ) ).toEqual( event )
  } )

  it( 'rejects a payload that belongs to another type', () => {
    expect( storedEvent.safeParse( { ...base, type: 'JobClaimed', payload: { message_id: 3 } } ).success ).toBe( false )
  } )

  it( 'rejects a JobClaimed payload without attempt', () => {
    expect( storedEvent.safeParse( { ...base, type: 'JobClaimed', payload: { job_id: 1 } } ).success ).toBe( false )
  } )

  it( 'rejects an unknown event type', () => {
    expect( storedEvent.safeParse( { ...base, type: 'Nope', payload: {} } ).success ).toBe( false )
  } )

  it( 'does not yet carry cancelled_job_ids on StateTransitioned (arrives in 1.2)', () => {
    const payload = { from: 'GATE_BRIEF', to: 'SA_REVIEW', trigger: 'approve', state_rev: 2, cancelled_job_ids: [ 4 ] }

    expect( storedEvent.safeParse( { ...base, type: 'StateTransitioned', payload } ).success ).toBe( false )
  } )
} )

describe( 'deltaEvent', () => {
  it( 'carries project_id, job_id and text, with no id', () => {
    const event = { project_id: 'p1', job_id: 1, text: 'Hel' }

    expect( deltaEvent.parse( event ) ).toEqual( event )
  } )

  it( 'rejects an id, because deltas are never replayed', () => {
    expect( deltaEvent.safeParse( { id: 1, project_id: 'p1', job_id: 1, text: 'Hel' } ).success ).toBe( false )
  } )
} )
