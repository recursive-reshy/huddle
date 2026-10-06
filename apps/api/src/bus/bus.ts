// Shared
import type { DeltaEvent } from '@huddle/shared'
// DB
import type { EventRow } from '#src/db/schema.js'
// Logger
import { logger } from '#src/logger.js'

export type BusEvent = EventRow | DeltaEvent

export type BusListener = ( event: BusEvent ) => void

export interface Bus {
  publish( event: BusEvent ): void
  subscribe( listener: BusListener ): () => void
  listenerCount(): number
}

export function createBus(): Bus {
  const listeners = new Set< BusListener >()
  const queue: BusEvent[] = []
  let delivering = false

  return {
    // a listener may publish while it is being called; that event waits its turn so every listener sees events in publish order
    publish( event: BusEvent ): void {
      queue.push( event )

      if( delivering ) {
        return
      }

      delivering = true

      try {
        for( let next = queue.shift(); next !== undefined; next = queue.shift() ) {
          for( const listener of [ ...listeners ] ) {
            try {
              listener( next )
            } catch( error ) {
              logger.error( { err: error }, 'bus listener threw' )
            }
          }
        }
      } finally {
        delivering = false
      }
    },

    subscribe( listener: BusListener ): () => void {
      // wrapped so subscribing the same function twice gives two independent subscriptions
      const entry: BusListener = ( event ) => listener( event )
      listeners.add( entry )

      return () => {
        listeners.delete( entry )
      }
    },

    listenerCount(): number {
      return listeners.size
    },
  }
}
