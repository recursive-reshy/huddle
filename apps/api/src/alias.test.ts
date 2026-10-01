// Packages
import { expect, it } from 'vitest'
// Src
import { createApp } from '#src/app.js'

it( 'resolves #src/* to the source and runs it', () => {
  const app = createApp()

  expect( typeof app ).toBe( 'function' )
  expect( typeof app.listen ).toBe( 'function' )
} )
