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
// Worker
import { recoverAtBoot } from '#src/worker/recovery.js'
import { createWorker } from '#src/worker/worker.js'

const port = Number( process.env.PORT ?? 3000 )
const config = loadConfig( process.env )

const db = openDatabase( config.databaseFile )
const applied = migrate( db.$client, { dir: path.resolve( config.migrationsDir ), snapshotDir: config.snapshotDir, now: Date.now() } )

if( applied.length > 0 ) {
  console.log( `applied migrations: ${ applied.join( ', ' ) }` )
}

const bus = createBus()

recoverAtBoot( db, bus, Date.now() )

// stub until the step client (E6): every job fails as non-retryable
const worker = createWorker( {
  db,
  bus,
  leaseMs: config.leaseMs,
  runStep: () => Promise.resolve( { ok: false, error: 'step client not implemented', retryable: false } ),
} )

worker.start()

const server = createApp().listen( port, () => {
  console.log( `api listening on ${port}` )
} )

process.once( 'SIGTERM', () => {
  server.close()
  void worker.stop().then( () => {
    db.$client.close()
    process.exit( 0 )
  } )
} )
