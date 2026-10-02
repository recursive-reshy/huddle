// Express
import type { Request } from 'express'
// Packages
import { describe, expect, it } from 'vitest'
// Current user
import { currentUser } from './current-user.js'

describe( 'currentUser', () => {
  it( 'is always the human, whatever the request carries', () => {
    expect( currentUser( {} as Request ) ).toEqual( { agent_id: 'human' } )
    expect( currentUser( { headers: { 'x-user': 'sa' } } as unknown as Request ) ).toEqual( { agent_id: 'human' } )
  } )
} )
