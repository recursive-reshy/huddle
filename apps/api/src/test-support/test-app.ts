// Express
import type { Express } from 'express'
// Packages
import type { AddressInfo } from 'node:net'

export interface TestApp {
  url: string
  request( path: string, init?: { method?: string, body?: unknown, rawBody?: string } ): Promise< { status: number, headers: Headers, body: unknown } >
  close(): Promise< void >
}

export async function startTestApp( app: Express ): Promise< TestApp > {
  const server = app.listen( 0 )
  await new Promise( ( resolve ) => server.once( 'listening', resolve ) )

  const url = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`

  return {
    url,

    async request( path, { method = 'GET', body, rawBody } = {} ): Promise< { status: number, headers: Headers, body: unknown } > {
      const payload = rawBody ?? ( body === undefined ? undefined : JSON.stringify( body ) )
      const response = await fetch( `${ url }${ path }`, { method, headers: payload === undefined ? {} : { 'content-type': 'application/json' }, body: payload } )

      return { status: response.status, headers: response.headers, body: await response.json() }
    },

    close(): Promise< void > {
      return new Promise( ( resolve ) => {
        server.close( () => resolve() )
        server.closeAllConnections()
      } )
    },
  }
}
