// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from './connection.js'
import type { EventRow } from './schema.js'

export type Tx = Parameters< Parameters< Db[ 'transaction' ] >[ 0 ] >[ 0 ]

export function writeTransaction< T >( db: Db, bus: Bus, callback: ( tx: Tx, events: EventRow[] ) => T ): T {
  const events: EventRow[] = []

  const result = db.transaction( ( tx ) => {
    const returned = callback( tx, events )

    if( returned instanceof Promise ) {
      throw new Error( 'writeTransaction callback must be synchronous: it returned a promise' )
    }

    return returned
  }, { behavior: 'immediate' } )

  for( const event of events ) {
    bus.publish( event )
  }

  return result
}
