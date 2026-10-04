// Packages
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Exchange {
  request: unknown
  // nothing is sent until the first write, so a handler that never writes holds the response before its headers
  writeHead( status: number ): void
  write( line: unknown ): void
  writeRaw( data: string | Uint8Array ): void
  end(): void
  destroy(): void
  closed: Promise< void >
}

export type ExchangeHandler = ( exchange: Exchange ) => void | Promise< void >

export interface FakeAgentService {
  url: string
  requests: { method: string, path: string, contentType: string | undefined, body: unknown }[]
  respondWith( handler: ExchangeHandler ): void
  close(): Promise< void >
}

export async function startFakeAgentService( initial: ExchangeHandler = ( { end } ) => end() ): Promise< FakeAgentService > {
  let handler = initial
  const requests: FakeAgentService[ 'requests' ] = []
  const sockets = new Set< import( 'node:net' ).Socket >()

  const server = http.createServer( ( req, res ) => {
    const chunks: Buffer[] = []

    req.on( 'data', ( chunk: Buffer ) => chunks.push( chunk ) )
    req.on( 'end', () => {
      const text = Buffer.concat( chunks ).toString( 'utf8' )
      const body: unknown = req.headers[ 'content-type' ]?.includes( 'json' ) ? JSON.parse( text ) : text

      requests.push( { method: req.method ?? '', path: req.url ?? '', contentType: req.headers[ 'content-type' ], body } )

      let headWritten = false

      function head( status: number ): void {
        if( !headWritten ) {
          headWritten = true
          res.writeHead( status, { 'content-type': 'application/x-ndjson' } )
        }
      }

      const closed = new Promise< void >( ( resolve ) => res.on( 'close', resolve ) )

      void handler( {
        request: body,
        writeHead: head,
        write( line ): void {
          head( 200 )
          res.write( `${ JSON.stringify( line ) }\n` )
        },
        writeRaw( data ): void {
          head( 200 )
          res.write( data )
        },
        end(): void {
          head( 200 )
          res.end()
        },
        destroy(): void {
          res.destroy()
        },
        closed,
      } )
    } )
  } )

  server.on( 'connection', ( socket ) => {
    sockets.add( socket )
    socket.on( 'close', () => sockets.delete( socket ) )
  } )

  await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) )

  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${ port }`,
    requests,
    respondWith( next ): void {
      handler = next
    },
    async close(): Promise< void > {
      for( const socket of sockets ) {
        socket.destroy()
      }

      await new Promise< void >( ( resolve ) => server.close( () => resolve() ) )
    },
  }
}
