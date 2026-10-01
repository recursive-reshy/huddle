// Packages
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface MigrateOptions {
  dir: string
  snapshotDir: string
  now: number
}

const migrationFile = /^\d{4}_[a-z0-9_]+\.sql$/
const snapshotFile = /\.pre-.+\.(\d+)\.db$/
const snapshotsKept = 3

export function migrate( db: Database.Database, { dir, snapshotDir, now }: MigrateOptions ): string[] {
  db.exec( 'CREATE TABLE IF NOT EXISTS schema_migrations( name TEXT PRIMARY KEY, sha256 TEXT NOT NULL CHECK( length( sha256 ) = 64 ), applied_at INTEGER NOT NULL )' )

  const files = fs.readdirSync( dir ).filter( ( file ) => migrationFile.test( file ) ).sort()
  const tracked = db.prepare( 'SELECT name, sha256 FROM schema_migrations' ).all() as { name: string, sha256: string }[]

  for( const { name, sha256 } of tracked ) {
    if( !files.includes( name ) ) {
      throw new Error( `Migration ${ name } is missing from ${ dir }` )
    }

    if( hashOf( path.join( dir, name ) ) !== sha256 ) {
      throw new Error( `Migration ${ name } has changed since it was applied` )
    }
  }

  const trackedNames = new Set( tracked.map( ( row ) => row.name ) )
  const pending = files.filter( ( file ) => !trackedNames.has( file ) )

  if( pending.length === 0 ) {
    return []
  }

  const otherTables = db.prepare( 'SELECT count(*) AS n FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' AND name <> \'schema_migrations\'' ).get() as { n: number }

  if( tracked.length > 0 || otherTables.n > 0 ) {
    takeSnapshot( db, snapshotDir, pending[ 0 ]!, now )
  }

  for( const name of pending ) {
    applyFile( db, dir, name, now )
  }

  return pending
}

function hashOf( file: string ): string {
  return createHash( 'sha256' ).update( fs.readFileSync( file ) ).digest( 'hex' )
}

function takeSnapshot( db: Database.Database, snapshotDir: string, firstPending: string, now: number ): void {
  fs.mkdirSync( snapshotDir, { recursive: true } )

  const target = path.join( snapshotDir, `${ path.parse( db.name ).name }.pre-${ path.parse( firstPending ).name }.${ now }.db` )
  db.prepare( 'VACUUM INTO ?' ).run( target )

  const stale = fs.readdirSync( snapshotDir )
    .map( ( file ) => ( { file, taken: Number( snapshotFile.exec( file )?.[ 1 ] ) } ) )
    .filter( ( { taken } ) => !Number.isNaN( taken ) )
    .sort( ( a, b ) => b.taken - a.taken )
    .slice( snapshotsKept )

  for( const { file } of stale ) {
    fs.rmSync( path.join( snapshotDir, file ) )
  }
}

function applyFile( db: Database.Database, dir: string, name: string, now: number ): void {
  const bytes = fs.readFileSync( path.join( dir, name ) )
  const sha256 = createHash( 'sha256' ).update( bytes ).digest( 'hex' )

  // SQLite ignores PRAGMA foreign_keys inside a transaction, so it is toggled around BEGIN/COMMIT
  db.pragma( 'foreign_keys = OFF' )

  try {
    db.exec( 'BEGIN IMMEDIATE' )

    try {
      db.exec( bytes.toString( 'utf8' ) )
    } catch( error ) {
      throw new Error( `Migration ${ name } failed: ${ ( error as Error ).message }`, { cause: error } )
    }

    if( ( db.pragma( 'foreign_key_check' ) as unknown[] ).length > 0 ) {
      throw new Error( `Migration ${ name } left foreign key violations` )
    }

    db.prepare( 'INSERT INTO schema_migrations( name, sha256, applied_at ) VALUES( ?, ?, ? )' ).run( name, sha256, now )
    db.exec( 'COMMIT' )
  } catch( error ) {
    if( db.inTransaction ) {
      db.exec( 'ROLLBACK' )
    }

    throw error
  } finally {
    db.pragma( 'foreign_keys = ON' )
  }
}
