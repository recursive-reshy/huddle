// DB
import type { EventRow } from '#src/db/schema.js'

export type BusListener = ( event: EventRow ) => void

export interface Bus {
  publish( event: EventRow ): void
  subscribe( listener: BusListener ): () => void
  listenerCount(): number
}

export function createBus(): Bus {
  const listeners = new Set< BusListener >()

  return {
    publish( event: EventRow ): void {
      for( const listener of [ ...listeners ] ) {
        try {
          listener( event )
        } catch( error ) {
          console.error( 'bus listener threw', error )
        }
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
