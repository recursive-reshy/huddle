// Packages
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export type Db = BetterSQLite3Database & { $client: Database.Database }

export function openDatabase( file: string ): Db {
  fs.mkdirSync( path.dirname( file ), { recursive: true } )

  const client = new Database( file )
  client.pragma( 'journal_mode = WAL' )
  client.pragma( 'foreign_keys = ON' )
  client.pragma( 'busy_timeout = 5000' )

  return drizzle( client )
}
