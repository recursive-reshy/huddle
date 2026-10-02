// Packages
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Bus
import { createBus, type Bus } from '#src/bus/bus.js'
// DB
import type { EventRow } from '#src/db/schema.js'
// Errors
import { ConflictError, NotFoundError } from '#src/errors.js'
// Services
import { createProject } from './projects.service.js'
import { getThread, sendMessage } from './messages.service.js'
// Test support
import { readJob } from '#src/test-support/insert-job.js'
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

interface StoredEvent {
  type: string
  actor: string | null
  payload: string
}

let temp: TempDatabase
let bus: Bus
let published: EventRow[]
let projectId: string

function send( content = 'Hello', overrides: { projectId?: string, thread?: 'pm' | 'sa' } = {} ): ReturnType< typeof sendMessage > {
  return sendMessage( temp.db, bus, { projectId, thread: 'pm', content, author: 'human', ...overrides } )
}

function count( table: 'messages' | 'events' | 'jobs' ): number {
  return ( temp.db.$client.prepare( `SELECT count(*) AS n FROM ${ table }` ).get() as { n: number } ).n
}

function setState( state: string ): void {
  temp.db.$client.prepare( 'UPDATE projects SET current_state = ? WHERE id = ?' ).run( state, projectId )
}

function lastJobId(): number {
  return ( temp.db.$client.prepare( 'SELECT max(id) AS id FROM jobs' ).get() as { id: number } ).id
}

beforeEach( () => {
  temp = createTempDatabase()
  bus = createBus()
  published = []
  bus.subscribe( ( event ) => {
    if( 'id' in event ) {
      published.push( event )
    }
  } )
  projectId = createProject( temp.db, bus, { name: 'Huddle' } ).id
} )

afterEach( () => {
  temp.cleanup()
} )

describe( 'sendMessage', () => {
  it( 'stores the message as a chat from the author on the pm thread', () => {
    const message = send( 'Build me a tracker' )

    expect( message ).toEqual( { id: 1, project_id: projectId, thread: 'pm', author: 'human', kind: 'chat', content: 'Build me a tracker', created_at: expect.any( Number ) } )
  } )

  it( 'writes MessageCompleted with message_id and queues a pm_discovery_reply with the same message_id', () => {
    const message = send()

    const events = temp.db.$client.prepare( 'SELECT type, actor, payload FROM events ORDER BY id' ).all() as StoredEvent[]
    expect( events ).toEqual( [ { type: 'MessageCompleted', actor: 'human', payload: JSON.stringify( { message_id: message.id } ) } ] )

    const job = readJob( temp.db, lastJobId() )
    expect( job ).toMatchObject( { project_id: projectId, kind: 'pm_discovery_reply', agent: 'pm', status: 'queued', input: { message_id: message.id } } )
  } )

  it( 'publishes MessageCompleted after commit, once, and nothing else', () => {
    const message = send()

    expect( published ).toHaveLength( 1 )
    expect( published[ 0 ] ).toMatchObject( { type: 'MessageCompleted', project_id: projectId, actor: 'human', payload: { message_id: message.id } } )
  } )

  describe( 'refusals', () => {
    function expectNothingWritten( before: { messages: number, events: number, jobs: number } ): void {
      expect( { messages: count( 'messages' ), events: count( 'events' ), jobs: count( 'jobs' ) } ).toEqual( before )
      expect( published ).toHaveLength( before.events )
    }

    function snapshot(): { messages: number, events: number, jobs: number } {
      return { messages: count( 'messages' ), events: count( 'events' ), jobs: count( 'jobs' ) }
    }

    it( 'throws NotFoundError for an unknown project', () => {
      const before = snapshot()

      expect( () => send( 'Hi', { projectId: 'nope' } ) ).toThrow( NotFoundError )
      expectNothingWritten( before )
    } )

    it( 'throws ConflictError for the sa thread in DISCOVERY', () => {
      const before = snapshot()

      expect( () => send( 'Hi', { thread: 'sa' } ) ).toThrow( ConflictError )
      expectNothingWritten( before )
    } )

    it.each( [ 'BRIEF_DRAFT', 'GATE_BRIEF', 'SA_REVIEW', 'PRD_DRAFT', 'GATE_PRD', 'TRD_DRAFT', 'GATE_TRD', 'DONE', 'ESCALATED' ] )( 'throws ConflictError in %s', ( state ) => {
      setState( state )
      const before = snapshot()

      expect( () => send() ).toThrow( ConflictError )
      expectNothingWritten( before )
    } )

    it.each( [ 'queued', 'running' ] as const )( 'throws ConflictError while the reply job is %s, and writes nothing', ( status ) => {
      send()
      temp.db.$client.prepare( 'UPDATE jobs SET status = ?, lease_expires_at = ? WHERE id = ?' ).run( status, status === 'running' ? 99 : null, lastJobId() )
      const before = snapshot()

      expect( () => send( 'Second' ) ).toThrow( ConflictError )
      expectNothingWritten( before )
    } )

    it( 'checks the project before the state', () => {
      expect( () => send( 'Hi', { projectId: 'nope', thread: 'sa' } ) ).toThrow( NotFoundError )
    } )

    it( 'checks the state and thread before the reply in flight', () => {
      send()
      setState( 'GATE_BRIEF' )

      expect( () => send() ).toThrow( /does not accept messages/ )
    } )

    it( 'says why when a reply is in flight', () => {
      send()

      expect( () => send() ).toThrow( /reply .* in progress/ )
    } )
  } )

  describe( 'after a reply', () => {
    it.each( [ 'succeeded', 'failed', 'cancelled' ] )( 'accepts the next message once the reply job is %s', ( status ) => {
      send( 'First' )
      temp.db.$client.prepare( 'UPDATE jobs SET status = ?, finished_at = 1 WHERE id = ?' ).run( status, lastJobId() )

      const second = send( 'Second' )

      expect( second.id ).toBe( 2 )
      expect( count( 'jobs' ) ).toBe( 2 )
    } )
  } )

  it( 'lets another project take a message while this one has a reply in flight', () => {
    send()
    const other = createProject( temp.db, bus, { name: 'Other' } )

    expect( sendMessage( temp.db, bus, { projectId: other.id, thread: 'pm', content: 'Hi', author: 'human' } ).project_id ).toBe( other.id )
  } )

  it( 'leaves no message, event or job behind and publishes nothing when the transaction fails', () => {
    // a trigger on the temp database's jobs table makes the last insert of the transaction fail
    temp.db.$client.exec( "CREATE TRIGGER test_fail_job_insert BEFORE INSERT ON jobs BEGIN SELECT RAISE( ABORT, 'forced failure' ); END" )

    expect( () => send() ).toThrow( /forced failure/ )

    expect( { messages: count( 'messages' ), events: count( 'events' ), jobs: count( 'jobs' ) } ).toEqual( { messages: 0, events: 0, jobs: 0 } )
    expect( published ).toEqual( [] )
  } )

  it( 'accepts the next message after a forced failure once the cause is gone', () => {
    temp.db.$client.exec( "CREATE TRIGGER test_fail_job_insert BEFORE INSERT ON jobs BEGIN SELECT RAISE( ABORT, 'forced failure' ); END" )
    expect( () => send() ).toThrow()
    temp.db.$client.exec( 'DROP TRIGGER test_fail_job_insert' )

    expect( send().id ).toBe( 1 )
    expect( count( 'jobs' ) ).toBe( 1 )
  } )
} )

describe( 'getThread', () => {
  it( 'throws NotFoundError for an unknown project', () => {
    expect( () => getThread( temp.db, { projectId: 'nope', agent: 'pm' } ) ).toThrow( NotFoundError )
  } )

  it( 'is empty for a new project', () => {
    expect( getThread( temp.db, { projectId, agent: 'pm' } ) ).toEqual( [] )
  } )

  it( 'returns the thread oldest first', () => {
    const first = send( 'First' )
    temp.db.$client.prepare( "UPDATE jobs SET status = 'succeeded', finished_at = 1 WHERE id = ?" ).run( lastJobId() )
    const second = send( 'Second' )

    expect( getThread( temp.db, { projectId, agent: 'pm' } ) ).toEqual( [ first, second ] )
    expect( getThread( temp.db, { projectId, agent: 'sa' } ) ).toEqual( [] )
  } )
} )
