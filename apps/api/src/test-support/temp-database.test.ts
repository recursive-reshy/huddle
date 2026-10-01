// Packages
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
// Test support
import { createTempDatabase } from './temp-database.js'

describe( 'createTempDatabase', () => {
  it( 'returns a migrated database with the pragmas set', () => {
    const temp = createTempDatabase()

    const tables = temp.db.$client.prepare( 'SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'projects\'' ).all()

    expect( tables ).toHaveLength( 1 )
    expect( temp.db.$client.pragma( 'foreign_keys', { simple: true } ) ).toBe( 1 )

    temp.cleanup()
  } )

  it( 'removes the database and its directory on cleanup', () => {
    const temp = createTempDatabase()

    temp.cleanup()

    expect( fs.existsSync( temp.dir ) ).toBe( false )
  } )

  it( 'gives each call its own database', () => {
    const first = createTempDatabase()
    const second = createTempDatabase()

    expect( first.file ).not.toBe( second.file )

    first.cleanup()
    second.cleanup()
  } )
} )
