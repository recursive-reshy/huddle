// Packages
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import { writeTransaction } from './transaction.js'
import { projects, type EventRow } from './schema.js'
// Repositories
import { appendEvent } from '#src/repositories/events.repository.js'
// Test support
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

let temp: TempDatabase
let bus: Bus

function projectCount(): number {
  return ( temp.db.$client.prepare( 'SELECT count(*) AS n FROM projects' ).get() as { n: number } ).n
}

beforeEach( () => {
  temp = createTempDatabase()
  bus = createBus()
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'writeTransaction', () => {
  it( 'commits and returns what the callback returns', () => {
    const result = writeTransaction( temp.db, bus, ( tx ) => {
      tx.insert( projects ).values( { id: 'p1', name: 'One', current_state: 'DISCOVERY' } ).run()

      return 'done'
    } )

    expect( result ).toBe( 'done' )
    expect( projectCount() ).toBe( 1 )
  } )

  it( 'rolls back, rethrows and publishes nothing when the callback throws', () => {
    const listener = vi.fn()
    bus.subscribe( listener )

    expect( () => writeTransaction( temp.db, bus, ( tx, events ) => {
      tx.insert( projects ).values( { id: 'p1', name: 'One', current_state: 'DISCOVERY' } ).run()
      events.push( appendEvent( tx, { project_id: 'p1', type: 'JobClaimed', payload: {} } ) )

      throw new Error( 'boom' )
    } ) ).toThrow( 'boom' )

    expect( projectCount() ).toBe( 0 )
    expect( listener ).not.toHaveBeenCalled()
  } )

  it( 'throws and rolls back when the callback returns a promise', () => {
    const listener = vi.fn()
    bus.subscribe( listener )

    expect( () => writeTransaction( temp.db, bus, ( tx ) => {
      tx.insert( projects ).values( { id: 'p1', name: 'One', current_state: 'DISCOVERY' } ).run()

      return Promise.resolve( 'late' ) as unknown as string
    } ) ).toThrow( /promise/i )

    expect( projectCount() ).toBe( 0 )
    expect( listener ).not.toHaveBeenCalled()
  } )

  it( 'publishes the collected events only after the commit', () => {
    const seen: { inTransaction: boolean, rows: number, event: EventRow }[] = []
    bus.subscribe( ( event ) => {
      seen.push( { inTransaction: temp.db.$client.inTransaction, rows: projectCount(), event } )
    } )

    writeTransaction( temp.db, bus, ( tx, events ) => {
      tx.insert( projects ).values( { id: 'p1', name: 'One', current_state: 'DISCOVERY' } ).run()
      events.push( appendEvent( tx, { project_id: 'p1', type: 'JobClaimed', payload: { job_id: 1 } } ) )
      events.push( appendEvent( tx, { project_id: 'p1', type: 'JobCompleted', payload: { job_id: 1 } } ) )

      expect( seen ).toHaveLength( 0 )
    } )

    expect( seen.map( ( { event } ) => event.type ) ).toEqual( [ 'JobClaimed', 'JobCompleted' ] )
    expect( seen.every( ( { inTransaction, rows } ) => !inTransaction && rows === 1 ) ).toBe( true )
  } )

  it( 'holds the write lock from the start, before the first write (BEGIN IMMEDIATE)', () => {
    const other = new Database( temp.file )
    other.pragma( 'busy_timeout = 0' )

    let blocked: unknown

    writeTransaction( temp.db, bus, () => {
      try {
        other.exec( 'BEGIN IMMEDIATE' )
      } catch( error ) {
        blocked = error
      }
    } )

    expect( ( blocked as { code?: string } | undefined )?.code ).toBe( 'SQLITE_BUSY' )

    other.close()
  } )

  it( 'still returns, with the data committed, when a bus listener throws', () => {
    const after = vi.fn()
    const logged = vi.spyOn( console, 'error' ).mockImplementation( () => undefined )
    bus.subscribe( () => { throw new Error( 'listener broke' ) } )
    bus.subscribe( after )

    const result = writeTransaction( temp.db, bus, ( tx, events ) => {
      tx.insert( projects ).values( { id: 'p1', name: 'One', current_state: 'DISCOVERY' } ).run()
      events.push( appendEvent( tx, { project_id: 'p1', type: 'JobClaimed', payload: {} } ) )

      return 'committed'
    } )

    expect( result ).toBe( 'committed' )
    expect( projectCount() ).toBe( 1 )
    expect( after ).toHaveBeenCalledOnce()
    expect( logged ).toHaveBeenCalled()

    logged.mockRestore()
  } )
} )
