// Packages
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// DB
import { migrate } from './migrate.js'

const realDir = path.resolve( import.meta.dirname, '../../../../db' )

const trdTables = [
  'agents', 'projects', 'artifacts', 'artifact_versions', 'artifact_sections', 'jobs',
  'messages', 'events', 'clarifications', 'decisions', 'llm_calls', 'backups',
]

let root: string
let dir: string
let snapshotDir: string
let db: Database.Database

function writeFixture( name: string, sql: string ): void {
  fs.writeFileSync( path.join( dir, name ), sql )
}

function sha256Of( file: string ): string {
  return createHash( 'sha256' ).update( fs.readFileSync( file ) ).digest( 'hex' )
}

function tableNames(): string[] {
  const rows = db.prepare( 'SELECT name FROM sqlite_master WHERE type = \'table\'' ).all() as { name: string }[]

  return rows.map( ( row ) => row.name )
}

function trackedNames(): string[] {
  const rows = db.prepare( 'SELECT name FROM schema_migrations ORDER BY name' ).all() as { name: string }[]

  return rows.map( ( row ) => row.name )
}

function snapshots(): string[] {
  return fs.existsSync( snapshotDir ) ? fs.readdirSync( snapshotDir ).sort() : []
}

beforeEach( () => {
  root = fs.mkdtempSync( path.join( os.tmpdir(), 'migrate-' ) )
  dir = path.join( root, 'migrations' )
  snapshotDir = path.join( root, 'snapshots' )
  fs.mkdirSync( dir )
  db = new Database( path.join( root, 'app.db' ) )
} )

afterEach( () => {
  db.close()
  fs.rmSync( root, { recursive: true, force: true } )
} )

describe( 'migrate', () => {
  it( 'applies 0001 to a fresh database', () => {
    const testFile = path.join( realDir, '0001_init.test.mjs' )
    const testFileModifiedAt = fs.statSync( testFile ).mtimeMs

    const applied = migrate( db, { dir: realDir, snapshotDir, now: 1000 } )

    expect( applied ).toEqual( [ '0001_init.sql' ] )
    expect( db.prepare( 'SELECT name, sha256 FROM schema_migrations' ).all() ).toEqual( [
      { name: '0001_init.sql', sha256: sha256Of( path.join( realDir, '0001_init.sql' ) ) },
    ] )
    expect( tableNames() ).toEqual( expect.arrayContaining( trdTables ) )
    expect( fs.statSync( testFile ).mtimeMs ).toBe( testFileModifiedAt )
  } )

  it( 'applies nothing on a second run', () => {
    writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )
    migrate( db, { dir, snapshotDir, now: 1000 } )

    const applied = migrate( db, { dir, snapshotDir, now: 2000 } )

    expect( applied ).toEqual( [] )
    expect( trackedNames() ).toEqual( [ '0001_a.sql' ] )
    expect( snapshots() ).toEqual( [] )
  } )

  it( 'stops when an applied file has changed', () => {
    writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )
    migrate( db, { dir, snapshotDir, now: 1000 } )
    const before = db.prepare( 'SELECT * FROM schema_migrations' ).all()
    fs.appendFileSync( path.join( dir, '0001_a.sql' ), '\n-- edited\n' )
    writeFixture( '0002_b.sql', 'CREATE TABLE b( id INTEGER PRIMARY KEY );' )

    expect( () => migrate( db, { dir, snapshotDir, now: 2000 } ) )
      .toThrow( 'Migration 0001_a.sql has changed since it was applied' )

    expect( snapshots() ).toEqual( [] )
    expect( db.prepare( 'SELECT * FROM schema_migrations' ).all() ).toEqual( before )
    expect( tableNames() ).not.toContain( 'b' )
  } )

  it( 'stops when an applied file is missing', () => {
    writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )
    migrate( db, { dir, snapshotDir, now: 1000 } )
    fs.rmSync( path.join( dir, '0001_a.sql' ) )
    writeFixture( '0002_b.sql', 'CREATE TABLE b( id INTEGER PRIMARY KEY );' )

    expect( () => migrate( db, { dir, snapshotDir, now: 2000 } ) ).toThrow( '0001_a.sql' )

    expect( snapshots() ).toEqual( [] )
    expect( tableNames() ).not.toContain( 'b' )
  } )

  describe( 'snapshots', () => {
    it( 'takes none for a fresh database', () => {
      writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )

      migrate( db, { dir, snapshotDir, now: 1000 } )

      expect( snapshots() ).toEqual( [] )
    } )

    it( 'takes one before a later migration, holding only what was applied', () => {
      writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )
      migrate( db, { dir, snapshotDir, now: 1000 } )
      writeFixture( '0002_b.sql', 'CREATE TABLE b( id INTEGER PRIMARY KEY );' )

      migrate( db, { dir, snapshotDir, now: 2000 } )

      expect( snapshots() ).toEqual( [ 'app.pre-0002_b.2000.db' ] )
      const snapshot = new Database( path.join( snapshotDir, 'app.pre-0002_b.2000.db' ), { readonly: true } )
      const rows = snapshot.prepare( 'SELECT name FROM schema_migrations' ).all()
      const tables = snapshot.prepare( 'SELECT name FROM sqlite_master WHERE name = \'b\'' ).all()
      snapshot.close()
      expect( rows ).toEqual( [ { name: '0001_a.sql' } ] )
      expect( tables ).toEqual( [] )
    } )

    it( 'keeps only the newest three', () => {
      writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )
      migrate( db, { dir, snapshotDir, now: 1000 } )

      for( let index = 2; index <= 7; index++ ) {
        writeFixture( `000${ index }_t.sql`, `CREATE TABLE t${ index }( id INTEGER PRIMARY KEY );` )
        migrate( db, { dir, snapshotDir, now: index * 1000 } )
      }

      expect( snapshots() ).toEqual( [
        'app.pre-0005_t.5000.db',
        'app.pre-0006_t.6000.db',
        'app.pre-0007_t.7000.db',
      ] )
    } )
  } )

  describe( 'foreign keys', () => {
    it( 'are on again after a successful run', () => {
      writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )

      migrate( db, { dir, snapshotDir, now: 1000 } )

      expect( db.pragma( 'foreign_keys', { simple: true } ) ).toBe( 1 )
    } )

    it( 'report violations by file and roll the file back', () => {
      db.pragma( 'foreign_keys = ON' )
      writeFixture( '0001_bad.sql', `
        CREATE TABLE parent( id INTEGER PRIMARY KEY );
        CREATE TABLE child( id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent( id ) );
        INSERT INTO child( id, parent_id ) VALUES( 1, 99 );
      ` )

      let message = ''
      try {
        migrate( db, { dir, snapshotDir, now: 1000 } )
      } catch( error ) {
        message = ( error as Error ).message
      }

      expect( message ).toContain( 'Migration 0001_bad.sql left foreign key violations' )
      expect( message ).not.toContain( 'FOREIGN KEY constraint failed' )
      expect( tableNames() ).not.toContain( 'parent' )
      expect( tableNames() ).not.toContain( 'child' )
      expect( trackedNames() ).toEqual( [] )
      expect( db.pragma( 'foreign_keys', { simple: true } ) ).toBe( 1 )
    } )
  } )

  it( 'rolls back only the failing file', () => {
    writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )
    writeFixture( '0002_b.sql', 'CREATE TABLE b( id INTEGER PRIMARY KEY ); THIS IS NOT SQL;' )

    expect( () => migrate( db, { dir, snapshotDir, now: 1000 } ) ).toThrow( '0002_b.sql' )

    expect( trackedNames() ).toEqual( [ '0001_a.sql' ] )
    expect( tableNames() ).toContain( 'a' )
    expect( tableNames() ).not.toContain( 'b' )
    expect( db.pragma( 'foreign_keys', { simple: true } ) ).toBe( 1 )
  } )

  it( 'ignores files that are not migrations', () => {
    writeFixture( '0001_a.sql', 'CREATE TABLE a( id INTEGER PRIMARY KEY );' )
    writeFixture( 'README.md', '# notes' )
    writeFixture( '0003_x.test.mjs', 'throw new Error( "must not run" )' )

    const applied = migrate( db, { dir, snapshotDir, now: 1000 } )

    expect( applied ).toEqual( [ '0001_a.sql' ] )
    expect( trackedNames() ).toEqual( [ '0001_a.sql' ] )
  } )
} )
