// Packages
import path from 'node:path'
import { z } from 'zod'

const Env = z.object( {
  DATABASE_FILE: z.string().min( 1 ),
  MIGRATIONS_DIR: z.string().min( 1 ),
} )

export interface Config {
  databaseFile: string
  migrationsDir: string
  snapshotDir: string
}

export function loadConfig( env: NodeJS.ProcessEnv ): Config {
  const { DATABASE_FILE, MIGRATIONS_DIR } = Env.parse( env )

  return {
    databaseFile: DATABASE_FILE,
    migrationsDir: MIGRATIONS_DIR,
    snapshotDir: path.join( path.dirname( DATABASE_FILE ), 'snapshots' ),
  }
}
