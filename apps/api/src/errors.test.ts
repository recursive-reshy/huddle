// Packages
import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
// Errors
import { BudgetStopError, ConflictError, errorHandler, NotFoundError, ValidationError } from './errors.js'
// Logger
import { logger } from './logger.js'

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

  it( 'logs anything else with the logger and returns 500 without the message', async () => {
    const failure = new Error( 'database exploded' )
    const logged = vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    const base = serve( ( app ) => app.get( '/boom', () => { throw failure } ) )

    const response = await fetch( `${ base }/boom` )

    expect( response.status ).toBe( 500 )
    expect( await response.json() ).toEqual( { error: 'Internal Server Error' } )
    expect( logged ).toHaveBeenCalledWith( { err: failure }, 'request failed' )
  } )

  it( 'leaves a response that already started to Express, which closes the connection', async () => {
    vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    const base = serve( ( app ) => app.get( '/late', ( _req, res ) => {
      res.write( 'partial' )
      throw new Error( 'after headers' )
    } ) )

    const response = await fetch( `${ base }/late` )

    await expect( response.text() ).rejects.toThrow()
  } )

  it.each( [
    [ 'NotFoundError', 404, new NotFoundError( 'Project not found' ) ],
    [ 'ConflictError', 409, new ConflictError( 'A reply is already in flight' ) ],
    [ 'BudgetStopError', 402, new BudgetStopError( 'Monthly budget reached' ) ],
  ] )( 'maps %s to %i with { error: <message> } and does not log it', async ( _name, status, failure ) => {
    const logged = vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    const base = serve( ( app ) => app.get( '/typed', () => { throw failure } ) )

    const response = await fetch( `${ base }/typed` )

    expect( response.status ).toBe( status )
    expect( await response.json() ).toEqual( { error: failure.message } )
    expect( logged ).not.toHaveBeenCalled()
  } )

  it( 'maps a ValidationError to 400 with its issues', async () => {
    const base = serve( ( app ) => app.get( '/invalid', () => { throw new ValidationError( [ { message: 'name is taken' } ] ) } ) )

    const response = await fetch( `${ base }/invalid` )

    expect( response.status ).toBe( 400 )
    expect( await response.json() ).toEqual( { error: 'Bad Request', issues: [ { message: 'name is taken' } ] } )
  } )

  it( 'maps a typed error from a rejected promise too', async () => {
    const base = serve( ( app ) => app.get( '/late', async () => { throw new NotFoundError( 'gone' ) } ) )

    const response = await fetch( `${ base }/late` )

    expect( response.status ).toBe( 404 )
  } )

  it( 'maps a malformed JSON body to 400 instead of 500', async () => {
    const logged = vi.spyOn( logger, 'error' ).mockImplementation( () => undefined )
    const base = serve( ( app ) => {
      app.use( express.json() )
      app.post( '/echo', ( { body }, res ) => { res.json( body ) } )
    } )

    const response = await fetch( `${ base }/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' } )

    expect( response.status ).toBe( 400 )
    expect( await response.json() ).toEqual( { error: 'Bad Request', issues: [ { message: 'Request body is not valid JSON' } ] } )
    expect( logged ).not.toHaveBeenCalled()
  } )
} )
