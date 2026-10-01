// Packages
import path from 'node:path'
// App
import { createApp } from '#src/app.js'
import { loadConfig } from '#src/config.js'
// DB
import { openDatabase } from '#src/db/connection.js'
import { migrate } from '#src/db/migrate.js'

const port = Number( process.env.PORT ?? 3000 )
const config = loadConfig( process.env )

const db = openDatabase( config.databaseFile )
const applied = migrate( db.$client, { dir: path.resolve( config.migrationsDir ), snapshotDir: config.snapshotDir, now: Date.now() } )

if( applied.length > 0 ) {
  console.log( `applied migrations: ${ applied.join( ', ' ) }` )
}

createApp().listen( port, () => {
  console.log( `api listening on ${port}` )
} )
