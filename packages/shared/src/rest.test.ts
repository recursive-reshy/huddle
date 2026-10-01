// Packages
import { describe, expect, it } from 'vitest'
// Shared
import { createProjectBody, errorResponse, messageResponse, postMessageBody, projectResponse, threadResponse } from './rest.js'

describe( 'createProjectBody', () => {
  it( 'accepts a name', () => {
    expect( createProjectBody.parse( { name: 'Huddle' } ) ).toEqual( { name: 'Huddle' } )
  } )

  it( 'rejects an empty name', () => {
    expect( createProjectBody.safeParse( { name: '' } ).success ).toBe( false )
  } )
} )

describe( 'postMessageBody', () => {
  it( 'accepts a thread and content', () => {
    expect( postMessageBody.parse( { thread: 'pm', content: 'Hi' } ) ).toEqual( { thread: 'pm', content: 'Hi' } )
  } )

  it( 'rejects human as a thread', () => {
    expect( postMessageBody.safeParse( { thread: 'human', content: 'Hi' } ).success ).toBe( false )
  } )

  it( 'rejects empty content', () => {
    expect( postMessageBody.safeParse( { thread: 'pm', content: '' } ).success ).toBe( false )
  } )

  it( 'rejects an undeclared field', () => {
    expect( postMessageBody.safeParse( { thread: 'pm', content: 'Hi', author: 'sa' } ).success ).toBe( false )
  } )
} )

describe( 'projectResponse', () => {
  const project = { id: 'p1', name: 'Huddle', current_state: 'DISCOVERY', state_rev: 0, latest_event_id: 0 }

  it( 'uses the column names for state', () => {
    expect( projectResponse.parse( project ) ).toEqual( project )
  } )

  it( 'rejects an unknown state', () => {
    expect( projectResponse.safeParse( { ...project, current_state: 'BOGUS' } ).success ).toBe( false )
  } )
} )

describe( 'messageResponse and threadResponse', () => {
  const message = { id: 1, project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content: 'Hi', created_at: 1_700_000_000_000 }

  it( 'accepts a message', () => {
    expect( messageResponse.parse( message ) ).toEqual( message )
  } )

  it( 'accepts a thread of messages', () => {
    expect( threadResponse.parse( { messages: [ message ] } ) ).toEqual( { messages: [ message ] } )
  } )
} )

describe( 'errorResponse', () => {
  it( 'is { error }', () => {
    expect( errorResponse.parse( { error: 'Internal Server Error' } ) ).toEqual( { error: 'Internal Server Error' } )
  } )
} )
