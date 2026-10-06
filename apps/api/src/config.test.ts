// Packages
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
// Shared
import { jobKinds } from '@huddle/shared'
// Config
import { loadConfig, models, prices, recentMessages } from './config.js'

const env = { DATABASE_FILE: '/var/data/huddle.db', MIGRATIONS_DIR: '/srv/db' }

describe( 'loadConfig', () => {
  it( 'reads the database file and migrations dir from the environment', () => {
    const config = loadConfig( env )

    expect( config.databaseFile ).toBe( '/var/data/huddle.db' )
    expect( config.migrationsDir ).toBe( '/srv/db' )
  } )

  it( 'puts the snapshot dir next to the database file', () => {
    expect( loadConfig( env ).snapshotDir ).toBe( '/var/data/snapshots' )
  } )

  it( 'sets the job lease to 15 minutes', () => {
    expect( loadConfig( env ).leaseMs ).toBe( 15 * 60 * 1000 )
  } )

  it( 'throws a ZodError when DATABASE_FILE is missing', () => {
    expect( () => loadConfig( { MIGRATIONS_DIR: '/srv/db' } ) ).toThrow( ZodError )
  } )

  it( 'throws a ZodError when MIGRATIONS_DIR is missing', () => {
    expect( () => loadConfig( { DATABASE_FILE: '/var/data/huddle.db' } ) ).toThrow( ZodError )
  } )

  it( 'throws a ZodError when a path is empty', () => {
    expect( () => loadConfig( { ...env, DATABASE_FILE: '' } ) ).toThrow( ZodError )
  } )
} )

describe( 'models', () => {
  it( 'has an entry for every job kind', () => {
    expect( Object.keys( models ).sort() ).toEqual( [ ...jobKinds ].sort() )
  } )

  it.each( jobKinds.filter( ( kind ) => kind !== 'loop_summary' ) )( 'runs %s on claude-sonnet-5-5', ( kind ) => {
    expect( models[ kind ] ).toBe( 'claude-sonnet-5-5' )
  } )

  it( 'runs loop_summary on claude-haiku-4-5-20251001', () => {
    expect( models.loop_summary ).toBe( 'claude-haiku-4-5-20251001' )
  } )

  it( 'prices every model it names', () => {
    for( const model of Object.values( models ) ) {
      expect( prices ).toHaveProperty( model )
    }
  } )
} )

describe( 'prices', () => {
  it( 'prices sonnet in micro-dollars per million tokens, with the 5-minute cache write rate', () => {
    expect( prices[ 'claude-sonnet-5-5' ] ).toEqual( { input: 2_000_000, output: 10_000_000, cache_write: 2_500_000, cache_read: 200_000 } )
  } )

  it( 'prices haiku in micro-dollars per million tokens, with the 5-minute cache write rate', () => {
    expect( prices[ 'claude-haiku-4-5-20251001' ] ).toEqual( { input: 1_000_000, output: 5_000_000, cache_write: 1_250_000, cache_read: 100_000 } )
  } )

  it( 'prices fake at zero', () => {
    expect( prices.fake ).toEqual( { input: 0, output: 0, cache_write: 0, cache_read: 0 } )
  } )

  it( 'holds only safe integers', () => {
    for( const row of Object.values( prices ) ) {
      for( const price of Object.values( row ) ) {
        expect( Number.isSafeInteger( price ) ).toBe( true )
      }
    }
  } )
} )

describe( 'recentMessages', () => {
  it( 'is 20', () => {
    expect( recentMessages ).toBe( 20 )
  } )
} )

describe( 'loadConfig agent service settings', () => {
  it( 'defaults AGENTS_URL to http://localhost:8000', () => {
    expect( loadConfig( env ).agentsUrl ).toBe( 'http://localhost:8000' )
  } )

  it( 'reads AGENTS_URL from the environment', () => {
    expect( loadConfig( { ...env, AGENTS_URL: 'http://agents:8000' } ).agentsUrl ).toBe( 'http://agents:8000' )
  } )

  it( 'throws a ZodError when AGENTS_URL is not a URL', () => {
    expect( () => loadConfig( { ...env, AGENTS_URL: 'agents' } ) ).toThrow( ZodError )
  } )

  it( 'aborts a step after 60 seconds with no line', () => {
    expect( loadConfig( env ).stepIdleMs ).toBe( 60_000 )
  } )

  it( 'aborts a step after 10 minutes in total', () => {
    expect( loadConfig( env ).stepTotalMs ).toBe( 600_000 )
  } )
} )
