// Packages
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// App
import { createApp } from './app.js'
// Bus
import { createBus } from './bus/bus.js'
// Test support
import { createTempDatabase, type TempDatabase } from './test-support/temp-database.js'

describe( 'GET /api/health', () => {
  const servers: ReturnType< ReturnType< typeof createApp >[ 'listen' ] >[] = []

  let temp: TempDatabase

  beforeEach( () => {
    temp = createTempDatabase()
  } )

  afterEach( async () => {
    await Promise.all( servers.splice( 0 ).map( ( server ) => new Promise( ( resolve ) => server.close( resolve ) ) ) )
    temp.cleanup()
  } )

  it( 'returns 200 and { status: ok }', async () => {
    const server = createApp( { db: temp.db, bus: createBus() } ).listen( 0 )
    servers.push( server )
    const { port } = server.address() as AddressInfo

    const response = await fetch( `http://127.0.0.1:${port}/api/health` )

    expect( response.status ).toBe( 200 )
    expect( await response.json() ).toEqual( { status: 'ok' } )
  } )
} )

describe( 'createApp', () => {
  it( 'puts the db and the bus on app.locals', () => {
    const temp = createTempDatabase()
    const bus = createBus()

    const app = createApp( { db: temp.db, bus } )

    expect( app.locals.db ).toBe( temp.db )
    expect( app.locals.bus ).toBe( bus )

    temp.cleanup()
  } )
} )
