// Packages
import path from 'node:path'
// App
import { createApp } from '#src/app.js'
import { loadConfig } from '#src/config.js'
// Bus
import { createBus } from '#src/bus/bus.js'
// DB
import { openDatabase } from '#src/db/connection.js'
import { migrate } from '#src/db/migrate.js'
// Logger
import { logger } from '#src/logger.js'
// Worker
import { recoverAtBoot } from '#src/worker/recovery.js'
import { createWorker } from '#src/worker/worker.js'

const port = Number( process.env.PORT ?? 3000 )
const config = loadConfig( process.env )

const db = openDatabase( config.databaseFile )
const applied = migrate( db.$client, { dir: path.resolve( config.migrationsDir ), snapshotDir: config.snapshotDir, now: Date.now() } )

if( applied.length > 0 ) {
  logger.info( { applied }, 'applied migrations' )
}

const bus = createBus()

recoverAtBoot( db, bus, Date.now() )

// stub until the pm_discovery_reply handler (E9): every job fails as non-retryable, which shows the flow ran end to end
const worker = createWorker( {
  db,
  bus,
  leaseMs: config.leaseMs,
  runStep: () => Promise.resolve( { ok: false, error: 'no handler', retryable: false } ),
} )

worker.start()

const server = createApp( { db, bus } ).listen( port, () => {
  logger.info( { port }, 'api listening' )
} )

process.once( 'SIGTERM', () => {
  server.close()
  void worker.stop().then( () => {
    db.$client.close()
    process.exit( 0 )
  } )
} )
