// Packages
import type { ZodError } from 'zod'
// Shared
import { stepLine, stepRequest, type StepRequest } from '@huddle/shared'
// Bus
import type { Bus } from '#src/bus/bus.js'
// Config
import type { Config } from '#src/config.js'
// DB
import type { Db } from '#src/db/connection.js'
import type { JobRow } from '#src/db/schema.js'
// Logger
import { logger } from '#src/logger.js'
// Services
import { recordLlmCall } from '#src/services/llm-calls.service.js'
// Worker
import type { StepOutcome } from './worker.js'

export type StepClientDeps = Pick< Config, 'agentsUrl' | 'stepIdleMs' | 'stepTotalMs' > & { db: Db, bus: Bus }

const maxSummaryLength = 300

function failed( error: string, retryable: boolean ): StepOutcome {
  return { ok: false, error, retryable }
}

function contractFailure( summary: string ): StepOutcome {
  return failed( `contract: ${ summary }`.slice( 0, maxSummaryLength ), false )
}

function summarize( { issues }: ZodError ): string {
  return issues.map( ( { path, message } ) => `${ path.join( '.' ) || 'line' }: ${ message }` ).join( '; ' )
}

export async function callStep( { db, bus, agentsUrl, stepIdleMs, stepTotalMs }: StepClientDeps, { job, request, signal }: { job: JobRow, request: StepRequest, signal: AbortSignal } ): Promise< StepOutcome > {
  const checked = stepRequest.safeParse( request )

  if( !checked.success ) {
    return contractFailure( summarize( checked.error ) )
  }

  if( signal.aborted ) {
    return failed( 'aborted', true )
  }

  const controller = new AbortController()
  let reason: string | undefined

  function abort( label: string ): void {
    reason ??= label
    controller.abort()
  }

  function startIdleTimer(): NodeJS.Timeout {
    return setTimeout( () => abort( 'idle timeout' ), stepIdleMs )
  }

  const onCallerAbort = (): void => abort( 'aborted' )
  const totalTimer = setTimeout( () => abort( 'total timeout' ), stepTotalMs )
  let idleTimer = startIdleTimer()

  signal.addEventListener( 'abort', onCallerAbort, { once: true } )

  function handleLine( text: string ): StepOutcome | undefined {
    clearTimeout( idleTimer )
    idleTimer = startIdleTimer()

    let json: unknown

    try {
      json = JSON.parse( text )
    } catch( error ) {
      return contractFailure( `line is not JSON (${ error instanceof Error ? error.message : 'unparseable' })` )
    }

    const parsed = stepLine.safeParse( json )

    if( !parsed.success ) {
      return contractFailure( summarize( parsed.error ) )
    }

    const line = parsed.data

    if( line.type === 'result' ) {
      return { ok: true, result: line }
    }

    if( line.type === 'error' ) {
      return failed( `${ line.code }: ${ line.message }`, line.retryable )
    }

    if( line.type === 'delta' ) {
      bus.publish( { project_id: job.project_id, job_id: job.id, text: line.text } )
    } else if( line.type === 'usage' ) {
      recordLlmCall( db, bus, { job, requestedModel: request.model, usage: line } )
    }

    logger.debug( { type: line.type }, 'step line' )

    return undefined
  }

  try {
    const response = await fetch( new URL( '/v1/steps', agentsUrl ), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify( checked.data ),
      signal: controller.signal,
    } )

    if( response.status !== 200 ) {
      await response.body?.cancel()

      return failed( `http ${ response.status }`, true )
    }

    if( !response.body ) {
      return failed( 'stream ended without result', true )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for( ;; ) {
      const { done, value } = await reader.read()

      if( done ) {
        const leftover = `${ buffer }${ decoder.decode() }`.trim()
        const outcome = leftover === '' ? undefined : handleLine( leftover )

        return outcome ?? failed( 'stream ended without result', true )
      }

      buffer += decoder.decode( value, { stream: true } )

      for( let newline = buffer.indexOf( '\n' ); newline !== -1; newline = buffer.indexOf( '\n' ) ) {
        const text = buffer.slice( 0, newline )

        buffer = buffer.slice( newline + 1 )

        if( text.trim() === '' ) {
          continue
        }

        const outcome = handleLine( text )

        if( outcome ) {
          return outcome
        }
      }
    }
  } catch( error ) {
    if( reason ) {
      return failed( reason, true )
    }

    // undici reports a refused, reset or terminated connection as a TypeError; anything else is a bug and goes to the worker
    if( error instanceof TypeError ) {
      logger.warn( { err: error }, 'step connection failed' )

      return failed( 'connection failed', true )
    }

    throw error
  } finally {
    clearTimeout( idleTimer )
    clearTimeout( totalTimer )
    signal.removeEventListener( 'abort', onCallerAbort )
    // the call ends at the first result or error line, so close the connection whatever is still being sent
    controller.abort()
  }
}
