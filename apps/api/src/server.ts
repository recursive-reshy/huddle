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
import { createDispatcher } from '#src/worker/dispatcher.js'
import { createPmDiscoveryReplyHandler } from '#src/worker/handlers/pm-discovery-reply.handler.js'
import { recoverAtBoot } from '#src/worker/recovery.js'
import { callStep } from '#src/worker/step-client.js'
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

const stepClientDeps = { db, bus, agentsUrl: config.agentsUrl, stepIdleMs: config.stepIdleMs, stepTotalMs: config.stepTotalMs }

const worker = createWorker( {
  db,
  bus,
  leaseMs: config.leaseMs,
  runStep: createDispatcher( {
    pm_discovery_reply: createPmDiscoveryReplyHandler( { db, call: ( input ) => callStep( stepClientDeps, input ) } ),
  } ),
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
