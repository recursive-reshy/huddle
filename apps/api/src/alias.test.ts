// Packages
import { expect, it } from 'vitest'
// Src
import { createApp } from '#src/app.js'
import { createBus } from '#src/bus/bus.js'
import { createTempDatabase } from '#src/test-support/temp-database.js'

it( 'resolves #src/* to the source and runs it', () => {
  const temp = createTempDatabase()
  const app = createApp( { db: temp.db, bus: createBus() } )
  temp.cleanup()

  expect( typeof app ).toBe( 'function' )
  expect( typeof app.listen ).toBe( 'function' )
} )
