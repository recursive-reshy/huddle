export interface SseClient {
  response: Response
  next(): Promise< string >
  close(): void
}

export async function connectSse( url: string, headers: Record< string, string > = {} ): Promise< SseClient > {
  const controller = new AbortController()
  const response = await fetch( url, { headers, signal: controller.signal } )

  if( !response.body ) {
    throw new Error( 'response has no body' )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return {
    response,

    // one frame, including its blank-line terminator
    async next(): Promise< string > {
      while( !buffer.includes( '\n\n' ) ) {
        const { done, value } = await reader.read()

        if( done ) {
          throw new Error( 'stream ended before the next frame' )
        }

        buffer += decoder.decode( value, { stream: true } )
      }

      const end = buffer.indexOf( '\n\n' ) + 2
      const frame = buffer.slice( 0, end )
      buffer = buffer.slice( end )

      return frame
    },

    close(): void {
      controller.abort()
    },
  }
}
