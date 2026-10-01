// Packages
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
// App
import { createApp } from './app.js'

describe( 'GET /api/health', () => {
  const servers: ReturnType< ReturnType< typeof createApp >[ 'listen' ] >[] = []

  afterEach( async () => {
    await Promise.all( servers.splice( 0 ).map( ( server ) => new Promise( ( resolve ) => server.close( resolve ) ) ) )
  } )

  it( 'returns 200 and { status: ok }', async () => {
    const server = createApp().listen( 0 )
    servers.push( server )
    const { port } = server.address() as AddressInfo

    const response = await fetch( `http://127.0.0.1:${port}/api/health` )

    expect( response.status ).toBe( 200 )
    expect( await response.json() ).toEqual( { status: 'ok' } )
  } )
} )
