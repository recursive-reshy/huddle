// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Shared
import { stepRequest } from '@huddle/shared'
// DB
import { messages } from '#src/db/schema.js'
// Errors
import { NotFoundError } from '#src/errors.js'
// Config
import { recentMessages } from '#src/config.js'
// Worker
import { buildDiscoveryReplyContext } from './context-builder.js'
// Test support
import { insertJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

let temp: TempDatabase

function addMessage( content: string, overrides: Partial< typeof messages.$inferInsert > = {} ): number {
  return temp.db.insert( messages ).values( { project_id: 'p1', thread: 'pm', author: 'human', kind: 'chat', content, ...overrides } ).returning( { id: messages.id } ).get().id
}

function jobAnswering( messageId: number ): ReturnType< typeof insertJob > {
  return insertJob( temp.db, { input: { message_id: messageId } } )
}

beforeEach( () => {
  temp = createTempDatabase()
  temp.db.$client.prepare( "INSERT INTO projects ( id, name, current_state ) VALUES ( 'p1', 'Huddle', 'DISCOVERY' )" ).run()
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'buildDiscoveryReplyContext', () => {
  it( 'has all seven fields, in TRD §6 order', () => {
    const job = jobAnswering( addMessage( 'Hi' ) )

    const context = buildDiscoveryReplyContext( temp.db, job )

    expect( Object.keys( context ) ).toEqual( [ 'project', 'artifacts', 'decisions', 'draft', 'questions', 'messages', 'task' ] )
  } )

  it( 'fills project and leaves artifacts, decisions, draft and questions as empty lists', () => {
    const job = jobAnswering( addMessage( 'Hi' ) )

    const context = buildDiscoveryReplyContext( temp.db, job )

    expect( context.project ).toEqual( { id: 'p1', name: 'Huddle' } )
    expect( context.artifacts ).toEqual( [] )
    expect( context.decisions ).toEqual( [] )
    expect( context.draft ).toEqual( [] )
    expect( context.questions ).toEqual( [] )
  } )

  it( 'sets task to empty notes, normal mode and may_ask false', () => {
    const job = jobAnswering( addMessage( 'Hi' ) )

    expect( buildDiscoveryReplyContext( temp.db, job ).task ).toEqual( { notes: '', mode: 'normal', may_ask: false } )
  } )

  it( 'maps messages to { author, kind, content }, oldest first', () => {
    addMessage( 'first' )
    addMessage( 'second', { author: 'pm' } )
    const job = jobAnswering( addMessage( 'third' ) )

    expect( buildDiscoveryReplyContext( temp.db, job ).messages ).toEqual( [
      { author: 'human', kind: 'chat', content: 'first' },
      { author: 'pm', kind: 'chat', content: 'second' },
      { author: 'human', kind: 'chat', content: 'third' },
    ] )
  } )

  it( 'never lets discussion, summary or system messages, or another thread, into the window', () => {
    addMessage( 'chat one' )
    addMessage( 'a discussion', { kind: 'discussion', author: 'pm' } )
    addMessage( 'a summary', { kind: 'summary', author: 'sa' } )
    addMessage( 'a system note', { kind: 'system', author: 'sa' } )
    addMessage( 'the sa thread', { thread: 'sa' } )
    const job = jobAnswering( addMessage( 'chat two' ) )

    const { messages: window } = buildDiscoveryReplyContext( temp.db, job )

    expect( window.map( ( { content } ) => content ) ).toEqual( [ 'chat one', 'chat two' ] )
    expect( window.every( ( { kind } ) => kind === 'chat' ) ).toBe( true )
  } )

  it( 'is limited to the last recentMessages (20) messages', () => {
    expect( recentMessages ).toBe( 20 )

    for( let index = 1; index <= 25; index++ ) {
      addMessage( `m${ index }` )
    }

    const job = jobAnswering( 25 )
    const { messages: window } = buildDiscoveryReplyContext( temp.db, job )

    expect( window ).toHaveLength( 20 )
    expect( window[ 0 ]?.content ).toBe( 'm6' )
    expect( window.at( -1 )?.content ).toBe( 'm25' )
  } )

  it( 'ends at the message the job answers, even when later messages exist', () => {
    addMessage( 'one' )
    const answered = addMessage( 'two' )
    addMessage( 'three' )
    const job = jobAnswering( answered )

    const { messages: window } = buildDiscoveryReplyContext( temp.db, job )

    expect( window.map( ( { content } ) => content ) ).toEqual( [ 'one', 'two' ] )
  } )

  it( 'produces a context that passes the generated StepRequest check', () => {
    const job = jobAnswering( addMessage( 'Hi' ) )

    const request = { job_id: job.id, attempt: 1, kind: job.kind, agent: job.agent, model: 'fake', context: buildDiscoveryReplyContext( temp.db, job ) }

    expect( stepRequest.safeParse( request ).success ).toBe( true )
  } )

  it( 'throws when the job input has no message_id', () => {
    const job = insertJob( temp.db, { input: {} } )

    expect( () => buildDiscoveryReplyContext( temp.db, job ) ).toThrow()
  } )

  it( 'throws NotFoundError for a project that does not exist', () => {
    const job = jobAnswering( addMessage( 'Hi' ) )

    expect( () => buildDiscoveryReplyContext( temp.db, { ...job, project_id: 'gone' } ) ).toThrow( NotFoundError )
  } )
} )
