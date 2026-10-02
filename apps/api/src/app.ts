// Express
import express, { type Express, type Request, type Response } from 'express'
// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from '#src/db/connection.js'
// Errors
import { errorHandler } from '#src/errors.js'
// Routes
import { messagesRoutes } from '#src/routes/messages.routes.js'
import { projectsRoutes } from '#src/routes/projects.routes.js'
import { streamRoutes } from '#src/stream/stream.routes.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      db: Db
      bus: Bus
    }
  }
}

export function createApp( { db, bus }: { db: Db, bus: Bus } ): Express {
  const app = express()

  app.disable( 'x-powered-by' )
  app.use( express.json() )

  app.locals.db = db
  app.locals.bus = bus

  app.get( '/api/health', ( _req: Request, res: Response ) => {
    res.status( 200 ).json( { status: 'ok' } )
  } )

  app.use( '/api', projectsRoutes )
  app.use( '/api', messagesRoutes )
  app.use( '/api', streamRoutes )

  app.use( errorHandler )

  return app
}
