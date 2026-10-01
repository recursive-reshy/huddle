// Express
import express, { type Express, type Request, type Response } from 'express'

export function createApp(): Express {
  const app = express()

  app.get( '/api/health', ( _req: Request, res: Response ) => {
    res.status( 200 ).json( { status: 'ok' } )
  } )

  return app
}
