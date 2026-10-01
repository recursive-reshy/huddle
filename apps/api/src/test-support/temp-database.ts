// Packages
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// DB
import { openDatabase, type Db } from '#src/db/connection.js'
import { migrate } from '#src/db/migrate.js'

export interface TempDatabase {
  db: Db
  file: string
  dir: string
  cleanup(): void
}

const migrationsDir = path.resolve( import.meta.dirname, '../../../../db' )

export function createTempDatabase(): TempDatabase {
  const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'huddle-api-' ) )
  const file = path.join( dir, 'test.db' )
  const db = openDatabase( file )

  migrate( db.$client, { dir: migrationsDir, snapshotDir: path.join( dir, 'snapshots' ), now: Date.now() } )

  return {
    db,
    file,
    dir,
    cleanup(): void {
      db.$client.close()
      fs.rmSync( dir, { recursive: true, force: true } )
    },
  }
}
