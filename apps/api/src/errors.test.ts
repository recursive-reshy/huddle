// Packages
import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
// Errors
import { errorHandler } from './errors.js'

type TestServer = ReturnType< Express[ 'listen' ] >

const servers: TestServer[] = []

function serve( setup: ( app: Express ) => void ): string {
  const app = express()
  setup( app )
  app.use( errorHandler )

  const server = app.listen( 0 )
  servers.push( server )

  return `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`
}

afterEach( async () => {
  vi.restoreAllMocks()
  await Promise.all( servers.splice( 0 ).map( ( server ) => new Promise( ( resolve ) => {
    server.close( resolve )
    server.closeAllConnections()
  } ) ) )
} )

describe( 'errorHandler', () => {
  it( 'maps a ZodError to 400', async () => {
    const base = serve( ( app ) => app.get( '/zod', () => z.number().parse( 'x' ) ) )

    const response = await fetch( `${ base }/zod` )

    expect( response.status ).toBe( 400 )
    expect( await response.json() ).toMatchObject( { error: 'Bad Request' } )
  } )

  it( 'maps a ZodError from a rejected promise to 400 too', async () => {
    const base = serve( ( app ) => app.get( '/zod', async () => z.number().parse( 'x' ) ) )

    const response = await fetch( `${ base }/zod` )

    expect( response.status ).toBe( 400 )
  } )

  it( 'logs anything else with console.error and returns 500 without the message', async () => {
    const failure = new Error( 'database exploded' )
    const logged = vi.spyOn( console, 'error' ).mockImplementation( () => undefined )
    const base = serve( ( app ) => app.get( '/boom', () => { throw failure } ) )

    const response = await fetch( `${ base }/boom` )

    expect( response.status ).toBe( 500 )
    expect( await response.json() ).toEqual( { error: 'Internal Server Error' } )
    expect( logged ).toHaveBeenCalledWith( expect.anything(), failure )
  } )

  it( 'leaves a response that already started to Express, which closes the connection', async () => {
    vi.spyOn( console, 'error' ).mockImplementation( () => undefined )
    const base = serve( ( app ) => app.get( '/late', ( _req, res ) => {
      res.write( 'partial' )
      throw new Error( 'after headers' )
    } ) )

    const response = await fetch( `${ base }/late` )

    await expect( response.text() ).rejects.toThrow()
  } )
} )
