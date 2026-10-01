// Packages
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
// Config
import { loadConfig } from './config.js'

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
