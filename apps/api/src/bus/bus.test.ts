// Packages
import { describe, expect, it, vi } from 'vitest'
// Shared
import type { DeltaEvent } from '@huddle/shared'
// Bus
import { createBus } from './bus.js'
// DB
import type { EventRow } from '#src/db/schema.js'
// Logger
import { logger } from '#src/logger.js'

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

  it( 'delivers a delta event, which has no id, the same way', () => {
    const bus = createBus()
    const listener = vi.fn()
    const delta: DeltaEvent = { project_id: 'p1', job_id: 1, text: 'Hel' }
    bus.subscribe( listener )

    bus.publish( delta )

    expect( listener ).toHaveBeenCalledWith( delta )
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
    const logged = vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    bus.subscribe( () => { throw failure } )
    bus.subscribe( after )

    expect( () => bus.publish( event ) ).not.toThrow()

    expect( after ).toHaveBeenCalledWith( event )
    expect( logged ).toHaveBeenCalledWith( { err: failure }, 'bus listener threw' )

    logged.mockRestore()
  } )
} )

describe( 'bus delivery order', () => {
  const eventOf = ( id: number ): EventRow => ( { ...event, id } )

  it( 'delivers an event published during delivery after the one being delivered, to every listener', () => {
    const bus = createBus()
    const seenByX: number[] = []
    const seenByY: number[] = []
    bus.subscribe( ( received ) => {
      if( 'id' in received ) {
        seenByX.push( received.id )

        if( received.id === 1 ) {
          bus.publish( eventOf( 2 ) )
        }
      }
    } )
    bus.subscribe( ( received ) => {
      if( 'id' in received ) {
        seenByY.push( received.id )
      }
    } )

    bus.publish( eventOf( 1 ) )

    expect( seenByX ).toEqual( [ 1, 2 ] )
    expect( seenByY ).toEqual( [ 1, 2 ] )
  } )

  it( 'keeps delivering queued events to the other listeners when one listener throws', () => {
    const bus = createBus()
    const logged = vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    const seen: number[] = []
    bus.subscribe( ( received ) => {
      if( 'id' in received && received.id === 1 ) {
        bus.publish( eventOf( 2 ) )
        bus.publish( eventOf( 3 ) )
      }
    } )
    bus.subscribe( ( received ) => {
      if( 'id' in received && received.id === 2 ) {
        throw new Error( 'listener broke on the queued event' )
      }
    } )
    bus.subscribe( ( received ) => {
      if( 'id' in received ) {
        seen.push( received.id )
      }
    } )

    expect( () => bus.publish( eventOf( 1 ) ) ).not.toThrow()

    expect( seen ).toEqual( [ 1, 2, 3 ] )
    expect( logged ).toHaveBeenCalledTimes( 1 )

    logged.mockRestore()
  } )

  it( 'delivers again after a delivery that threw', () => {
    const bus = createBus()
    const seen = vi.fn()
    vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    bus.subscribe( () => { throw new Error( 'always' ) } )
    bus.subscribe( seen )

    bus.publish( eventOf( 1 ) )
    bus.publish( eventOf( 2 ) )

    expect( seen ).toHaveBeenCalledTimes( 2 )
  } )
} )

