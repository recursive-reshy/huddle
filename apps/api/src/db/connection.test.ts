// Packages
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// DB
import { openDatabase } from './connection.js'

let root: string

beforeEach( () => {
  root = fs.mkdtempSync( path.join( os.tmpdir(), 'connection-' ) )
} )

afterEach( () => {
  fs.rmSync( root, { recursive: true, force: true } )
} )

describe( 'openDatabase', () => {
  it( 'sets the three pragmas on every connection', () => {
    const file = path.join( root, 'test.db' )

    for( const attempt of [ 1, 2 ] ) {
      const db = openDatabase( file )

      expect( db.$client.pragma( 'journal_mode', { simple: true } ), `attempt ${ attempt }` ).toBe( 'wal' )
      expect( db.$client.pragma( 'foreign_keys', { simple: true } ), `attempt ${ attempt }` ).toBe( 1 )
      expect( db.$client.pragma( 'busy_timeout', { simple: true } ), `attempt ${ attempt }` ).toBe( 5000 )

      db.$client.close()
    }
  } )

  it( 'creates the parent directory when it does not exist', () => {
    const file = path.join( root, 'data', 'nested', 'test.db' )

    const db = openDatabase( file )

    expect( fs.existsSync( file ) ).toBe( true )

    db.$client.close()
  } )
} )
