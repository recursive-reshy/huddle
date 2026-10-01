// Packages
import { describe, expect, it, vi } from 'vitest'
// Bus
import { createBus } from './bus.js'
// DB
import type { EventRow } from '#src/db/schema.js'

const event: EventRow = { id: 1, project_id: 'p1', type: 'JobClaimed', actor: null, payload: { job_id: 1 }, created_at: 1 }

describe( 'bus', () => {
  it( 'delivers a published event to every subscriber', () => {
    const bus = createBus()
    const first = vi.fn()
    const second = vi.fn()
    bus.subscribe( first )
    bus.subscribe( second )

    bus.publish( event )

    expect( first ).toHaveBeenCalledWith( event )
    expect( second ).toHaveBeenCalledWith( event )
  } )

  it( 'counts listeners and drops one on unsubscribe', () => {
    const bus = createBus()
    const unsubscribe = bus.subscribe( vi.fn() )
    bus.subscribe( vi.fn() )

    expect( bus.listenerCount() ).toBe( 2 )

    unsubscribe()

    expect( bus.listenerCount() ).toBe( 1 )
  } )

  it( 'stops delivering to an unsubscribed listener, and unsubscribing twice is harmless', () => {
    const bus = createBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe( listener )

    unsubscribe()
    unsubscribe()
    bus.publish( event )

    expect( listener ).not.toHaveBeenCalled()
    expect( bus.listenerCount() ).toBe( 0 )
  } )

  it( 'keeps the other listeners and logs when one throws', () => {
    const bus = createBus()
    const after = vi.fn()
    const failure = new Error( 'listener broke' )
    const logged = vi.spyOn( console, 'error' ).mockImplementation( () => undefined )
    bus.subscribe( () => { throw failure } )
    bus.subscribe( after )

    expect( () => bus.publish( event ) ).not.toThrow()

    expect( after ).toHaveBeenCalledWith( event )
    expect( logged ).toHaveBeenCalledWith( expect.anything(), failure )

    logged.mockRestore()
  } )
} )
