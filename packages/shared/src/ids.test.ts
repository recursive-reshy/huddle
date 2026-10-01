// Node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Packages
import { describe, expect, it } from 'vitest'
// Shared
import { agentId, threadId } from './ids.js'

const migrationPath = fileURLToPath( new URL( '../../../db/0001_init.sql', import.meta.url ) )

function seededAgents(): string[] {
  const seed = /INSERT INTO agents \(id, name\) VALUES([^;]+);/.exec( readFileSync( migrationPath, 'utf8' ) )

  if( !seed ) {
    throw new Error( 'db/0001_init.sql has no agents seed' )
  }

  return [ ...seed[ 1 ].matchAll( /\(\s*'([^']+)'/g ) ].map( ( match ) => match[ 1 ] )
}

describe( 'agentId', () => {
  it( 'matches the agents seeded in db/0001_init.sql exactly', () => {
    expect( [ ...agentId.options ].sort() ).toEqual( seededAgents().sort() )
  } )

  it.each( [ 'human', 'pm', 'sa', 'dba', 'ca' ] )( 'accepts %s', ( value ) => {
    expect( agentId.parse( value ) ).toBe( value )
  } )

  it( 'rejects an unknown agent', () => {
    expect( agentId.safeParse( 'dev' ).success ).toBe( false )
  } )
} )

describe( 'threadId', () => {
  it.each( [ 'pm', 'sa' ] )( 'accepts %s', ( value ) => {
    expect( threadId.parse( value ) ).toBe( value )
  } )

  it.each( [ 'human', 'dba', 'ca' ] )( 'rejects %s, because only pm and sa have threads', ( value ) => {
    expect( threadId.safeParse( value ).success ).toBe( false )
  } )
} )
