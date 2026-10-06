// Packages
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Shared
import { storedEvent } from '@huddle/shared'
// App
import { createApp } from '#src/app.js'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import { writeTransaction } from '#src/db/transaction.js'
import { projects, type EventRow } from '#src/db/schema.js'
// Repositories
import { appendEvent } from '#src/repositories/events.repository.js'
// Test support
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'
import { connectSse, type SseClient } from '#src/test-support/sse-client.js'

let temp: TempDatabase
let bus: Bus
let server: ReturnType< ReturnType< typeof createApp >[ 'listen' ] >
let url: string
let clients: SseClient[]

function append( attempt = 1 ): EventRow {
  return writeTransaction( temp.db, bus, ( tx, events ) => {
    const event = appendEvent( tx, { project_id: 'p1', type: 'JobClaimed', actor: 'pm', payload: { job_id: 7, attempt } } )
    events.push( event )

    return event
  } )
}

function frameOf( event: EventRow ): string {
  return `id: ${ event.id }\ndata: ${ JSON.stringify( event ) }\n\n`
}

async function connect( { lastEventId, since }: { lastEventId?: string, since?: string } = {} ): Promise< SseClient > {
  const client = await connectSse( since === undefined ? url : `${ url }?since=${ since }`, lastEventId === undefined ? {} : { 'Last-Event-ID': lastEventId } )
  clients.push( client )

  return client
}

async function listenersGone(): Promise< void > {
  await vi.waitFor( () => expect( bus.listenerCount() ).toBe( 0 ) )
}

beforeEach( async () => {
  vi.useFakeTimers( { toFake: [ 'setInterval', 'clearInterval' ] } )
  temp = createTempDatabase()
  temp.db.insert( projects ).values( { id: 'p1', name: 'One', current_state: 'DISCOVERY' } ).run()
  bus = createBus()
  clients = []
  server = createApp( { db: temp.db, bus } ).listen( 0 )
  await new Promise( ( resolve ) => server.once( 'listening', resolve ) )
  url = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }/api/stream`
} )

afterEach( async () => {
  for( const client of clients ) {
    client.close()
  }

  await listenersGone()
  await new Promise( ( resolve ) => {
    server.close( resolve )
    server.closeAllConnections()
  } )
  temp.cleanup()
  vi.useRealTimers()
} )

describe( 'GET /api/stream headers', () => {
  it( 'is an uncompressed, uncached text/event-stream, and subscribes while open', async () => {
    const client = await connect()

    expect( client.response.status ).toBe( 200 )
    expect( client.response.headers.get( 'content-type' ) ).toMatch( /^text\/event-stream/ )
    expect( client.response.headers.get( 'cache-control' ) ).toContain( 'no-cache' )
    expect( client.response.headers.get( 'content-encoding' ) ).toBeNull()
    expect( client.response.headers.get( 'x-accel-buffering' ) ).toBe( 'no' )
    expect( bus.listenerCount() ).toBe( 1 )

    client.close()
    await listenersGone()
  } )
} )

describe( 'GET /api/stream live frames', () => {
  it( 'sends a stored event as id: then data: with the StoredEvent JSON, and nothing else', async () => {
    const client = await connect()

    const event = append()
    const frame = await client.next()

    expect( frame ).toBe( frameOf( event ) )
    expect( frame.split( '\n' ).filter( Boolean ) ).toHaveLength( 2 )
    expect( storedEvent.parse( JSON.parse( frame.split( '\n' )[ 1 ].slice( 'data: '.length ) ) ) ).toEqual( event )

    client.close()
    await listenersGone()
  } )

  it( 'sends a delta as data: only, with no id: and no event: line', async () => {
    const client = await connect()
    const delta = { project_id: 'p1', job_id: 7, text: 'Hel' }

    bus.publish( delta )

    expect( await client.next() ).toBe( `data: ${ JSON.stringify( delta ) }\n\n` )

    client.close()
    await listenersGone()
  } )

  it( 'delivers every project\'s events to every connected client', async () => {
    const first = await connect()
    const second = await connect()

    const event = append()

    expect( await first.next() ).toBe( frameOf( event ) )
    expect( await second.next() ).toBe( frameOf( event ) )
    expect( bus.listenerCount() ).toBe( 2 )

    first.close()
    await vi.waitFor( () => expect( bus.listenerCount() ).toBe( 1 ) )
    second.close()
    await listenersGone()
  } )
} )

describe( 'GET /api/stream replay', () => {
  it( 'replays nothing without a cursor', async () => {
    append()
    append()
    const client = await connect()

    const live = append()

    expect( await client.next() ).toBe( frameOf( live ) )

    client.close()
    await listenersGone()
  } )

  it( 'replays the events after Last-Event-ID, in order, then continues live', async () => {
    const [ first, second, third ] = [ append(), append(), append() ]
    const client = await connect( { lastEventId: String( first.id ) } )

    expect( await client.next() ).toBe( frameOf( second ) )
    expect( await client.next() ).toBe( frameOf( third ) )

    const live = append()

    expect( await client.next() ).toBe( frameOf( live ) )

    client.close()
    await listenersGone()
  } )

  it( 'replays the events after ?since= on a fresh load', async () => {
    const [ first, second ] = [ append(), append() ]
    const client = await connect( { since: String( first.id ) } )

    expect( await client.next() ).toBe( frameOf( second ) )

    client.close()
    await listenersGone()
  } )

  it( 'replays everything after cursor 0', async () => {
    const [ first, second ] = [ append(), append() ]
    const client = await connect( { since: '0' } )

    expect( await client.next() ).toBe( frameOf( first ) )
    expect( await client.next() ).toBe( frameOf( second ) )

    client.close()
    await listenersGone()
  } )

  it( 'lets Last-Event-ID win over ?since= when both are sent', async () => {
    const [ first, second, third ] = [ append(), append(), append() ]
    const client = await connect( { lastEventId: String( second.id ), since: String( first.id ) } )

    expect( await client.next() ).toBe( frameOf( third ) )

    client.close()
    await listenersGone()
  } )

  it( 'never replays a delta, and a delta does not move the cursor', async () => {
    const first = append()
    bus.publish( { project_id: 'p1', job_id: 7, text: 'gone' } )
    const second = append()
    const client = await connect( { lastEventId: String( first.id ) } )

    expect( await client.next() ).toBe( frameOf( second ) )

    const delta = { project_id: 'p1', job_id: 8, text: 'live' }
    bus.publish( delta )

    expect( await client.next() ).toBe( `data: ${ JSON.stringify( delta ) }\n\n` )

    client.close()
    await listenersGone()
  } )

  it( 'sends an event once when the bus publishes one the replay already covered', async () => {
    const [ first, second ] = [ append(), append() ]
    const client = await connect( { lastEventId: '0' } )

    expect( await client.next() ).toBe( frameOf( first ) )
    expect( await client.next() ).toBe( frameOf( second ) )

    bus.publish( second )
    const third = append()

    expect( await client.next() ).toBe( frameOf( third ) )

    client.close()
    await listenersGone()
  } )
} )

describe( 'GET /api/stream invalid cursor', () => {
  it.each< [ string, { lastEventId?: string, since?: string } ] >( [
    [ 'a non-numeric Last-Event-ID', { lastEventId: 'abc' } ],
    [ 'a negative Last-Event-ID', { lastEventId: '-1' } ],
    [ 'a fractional Last-Event-ID', { lastEventId: '1.5' } ],
    [ 'an unsafe-integer Last-Event-ID', { lastEventId: '99999999999999999999' } ],
    [ 'a non-numeric ?since=', { since: 'abc' } ],
    [ 'a negative ?since=', { since: '-1' } ],
    [ 'an empty ?since=', { since: '' } ],
  ] )( 'returns 400 for %s and never subscribes', async ( _name, cursor ) => {
    const response = await fetch( cursor.since === undefined ? url : `${ url }?since=${ cursor.since }`, {
      headers: cursor.lastEventId === undefined ? {} : { 'Last-Event-ID': cursor.lastEventId },
    } )

    expect( response.status ).toBe( 400 )
    expect( response.headers.get( 'content-type' ) ).toMatch( /application\/json/ )
    expect( bus.listenerCount() ).toBe( 0 )
  } )
} )

describe( 'GET /api/stream heartbeat', () => {
  it( 'sends a ": ping" comment every 30 seconds and not before', async () => {
    const client = await connect()

    vi.advanceTimersByTime( 29_999 )
    const event = append()

    expect( await client.next() ).toBe( frameOf( event ) )

    vi.advanceTimersByTime( 1 )

    expect( await client.next() ).toBe( ': ping\n\n' )

    vi.advanceTimersByTime( 30_000 )

    expect( await client.next() ).toBe( ': ping\n\n' )

    client.close()
    await listenersGone()
  } )
} )

describe( 'GET /api/stream disconnect', () => {
  it( 'unsubscribes from the bus and stops its heartbeat when the client goes away', async () => {
    const client = await connect()

    expect( bus.listenerCount() ).toBe( 1 )
    expect( vi.getTimerCount() ).toBe( 1 )

    client.close()
    await listenersGone()

    expect( vi.getTimerCount() ).toBe( 0 )
  } )

  it( 'keeps serving the other clients after one disconnects', async () => {
    const gone = await connect()
    const stays = await connect()

    gone.close()
    await vi.waitFor( () => expect( bus.listenerCount() ).toBe( 1 ) )

    const event = append()

    expect( await stays.next() ).toBe( frameOf( event ) )

    stays.close()
    await listenersGone()
  } )
} )
