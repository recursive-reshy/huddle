// App
import { createApp } from '#src/app.js'

const port = Number( process.env.PORT ?? 3000 )

createApp().listen( port, () => {
  console.log( `api listening on ${port}` )
} )
