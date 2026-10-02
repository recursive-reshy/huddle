// Express
import type { Request, Response } from 'express'
// Packages
import { z } from 'zod'
// Bus
import type { BusEvent } from '#src/bus/bus.js'
// Services
import { replayEvents } from '#src/services/events.service.js'

export const heartbeatMs = 30_000

const cursor = z.string().regex( /^\d+$/ ).transform( Number ).pipe( z.number().int().safe() )

function frameOf( event: BusEvent ): string {
  return 'id' in event ? `id: ${ event.id }\ndata: ${ JSON.stringify( event ) }\n\n` : `data: ${ JSON.stringify( event ) }\n\n`
}

export function streamEvents( { app, headers, query }: Request, res: Response ): void {
  const { db, bus } = app.locals
  const raw = headers[ 'last-event-id' ] ?? query.since
  const since = raw === undefined ? undefined : cursor.parse( raw )

  res.writeHead( 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } )
  res.flushHeaders()

  let lastId = since ?? 0

  // a stored event is sent once: the replay and a late bus publish can both carry it
  function send( event: BusEvent ): void {
    if( 'id' in event ) {
      if( event.id <= lastId ) {
        return
      }

      lastId = event.id
    }

    res.write( frameOf( event ) )
  }

  // subscribe before replaying so nothing committed in between is missed; cleanup is registered before the replay can throw
  const unsubscribe = bus.subscribe( send )
  const heartbeat = setInterval( () => res.write( ': ping\n\n' ), heartbeatMs )

  res.on( 'close', () => {
    clearInterval( heartbeat )
    unsubscribe()
  } )

  if( since !== undefined ) {
    for( const event of replayEvents( db, since ) ) {
      send( event )
    }
  }
}
