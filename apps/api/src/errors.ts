// Express
import type { NextFunction, Request, Response } from 'express'
// Packages
import { ZodError } from 'zod'
// Logger
import { logger } from './logger.js'

export class ValidationError extends Error {
  issues: { message: string }[]

  constructor( issues: { message: string }[] ) {
    super( 'Bad Request' )
    this.issues = issues
  }
}

export class NotFoundError extends Error {}

export class ConflictError extends Error {}

export class BudgetStopError extends Error {}

function statusOf( error: unknown ): number | undefined {
  if( error instanceof NotFoundError ) {
    return 404
  }

  if( error instanceof ConflictError ) {
    return 409
  }

  if( error instanceof BudgetStopError ) {
    return 402
  }

  return undefined
}

// body-parser rejects an unparseable body with a 400 SyntaxError before any controller runs
function isBadJson( error: unknown ): boolean {
  return error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed'
}

export function errorHandler( error: unknown, _req: Request, res: Response, next: NextFunction ): void {
  if( error instanceof ZodError ) {
    res.status( 400 ).json( { error: 'Bad Request', issues: error.issues } )

    return
  }

  if( error instanceof ValidationError ) {
    res.status( 400 ).json( { error: 'Bad Request', issues: error.issues } )

    return
  }

  if( isBadJson( error ) ) {
    res.status( 400 ).json( { error: 'Bad Request', issues: [ { message: 'Request body is not valid JSON' } ] } )

    return
  }

  const status = statusOf( error )

  if( status !== undefined && error instanceof Error ) {
    res.status( status ).json( { error: error.message } )

    return
  }

  logger.error( { err: error }, 'request failed' )

  // once the response has started there is no status left to send; Express closes the connection
  if( res.headersSent ) {
    next( error )

    return
  }

  res.status( 500 ).json( { error: 'Internal Server Error' } )
}
