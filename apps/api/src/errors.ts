// Express
import type { NextFunction, Request, Response } from 'express'
// Packages
import { ZodError } from 'zod'

export function errorHandler( error: unknown, _req: Request, res: Response, next: NextFunction ): void {
  if( error instanceof ZodError ) {
    res.status( 400 ).json( { error: 'Bad Request', issues: error.issues } )

    return
  }

  console.error( 'request failed', error )

  // once the response has started there is no status left to send; Express closes the connection
  if( res.headersSent ) {
    next( error )

    return
  }

  res.status( 500 ).json( { error: 'Internal Server Error' } )
}
