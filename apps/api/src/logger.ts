// Packages
import pino, { type Logger } from 'pino'

export function createLogger( env: NodeJS.ProcessEnv ): Logger {
  return pino( { level: env.LOG_LEVEL ?? ( env.NODE_ENV === 'test' ? 'silent' : 'info' ) } )
}

export const logger: Logger = createLogger( process.env )
