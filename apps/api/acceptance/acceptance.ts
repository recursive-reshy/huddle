// Packages
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
// Shared
import {
  deltaEvent,
  messageEnvelope,
  projectEnvelope,
  storedEvent,
  threadEnvelope,
  type DeltaEvent,
  type StoredEvent,
} from '@huddle/shared'

// Milestone 1.1 acceptance (TRD §14): runs the real stack in Docker Compose, in fake mode, on its own project, port and data directory.
// Run it with `pnpm acceptance`; add `--keep` to leave the stack and its data up for debugging.

const waitMs = 30_000
const holdMs = 3_000
const settleMs = 2_000
const project = 'huddle-acceptance'
const port = 3100
const baseUrl = `http://127.0.0.1:${ port }`
const repoRoot = path.resolve( import.meta.dirname, '../../..' )
const dataDirectory = path.join( repoRoot, '.data', 'acceptance' )
const keep = process.argv.includes( '--keep' )
const run = promisify( execFile )

type Item = StoredEvent | DeltaEvent

interface Collector {
  items: Item[]
  failure: Error | undefined
  stored(): StoredEvent[]
  deltas(): DeltaEvent[]
  close(): void
}

function isStored( item: Item ): item is StoredEvent {
  return 'type' in item
}

function sleep( ms: number ): Promise< void > {
  return new Promise( ( resolve ) => setTimeout( resolve, ms ) )
}

async function compose( args: string[], timeoutMs = 120_000 ): Promise< string > {
  try {
    const { stdout } = await run(
      'docker',
      [ 'compose', '-p', project, '-f', 'compose.yaml', '-f', 'compose.acceptance.yaml', ...args ],
      { cwd: repoRoot, env: { ...process.env, API_PORT: String( port ) }, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
    )

    return stdout
  } catch( error ) {
    const { stderr = '' } = error as { stderr?: string }

    throw new Error( `docker compose ${ args.join( ' ' ) } failed: ${ stderr.trim() || String( error ) }`, { cause: error } )
  }
}

async function until( label: string, check: () => boolean, collectors: Collector[] = [] ): Promise< void > {
  const deadline = Date.now() + waitMs

  while( !check() ) {
    for( const collector of collectors ) {
      if( collector.failure ) {
        throw new Error( `stream failed while waiting for ${ label }: ${ collector.failure.message }`, { cause: collector.failure } )
      }
    }

    if( Date.now() > deadline ) {
      throw new Error( `timed out after ${ waitMs / 1000 } s waiting for ${ label }` )
    }

    await sleep( 50 )
  }
}

async function request< T >( method: string, route: string, schema: { parse( value: unknown ): T }, body?: unknown ): Promise< T > {
  const response = await fetch( `${ baseUrl }${ route }`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify( body ),
    signal: AbortSignal.timeout( waitMs ),
  } )

  assert.ok( response.ok, `${ method } ${ route } returned ${ response.status }` )

  return schema.parse( await response.json() )
}

function parseFrame( frame: string ): Item | undefined {
  const lines = frame.split( '\n' )

  if( lines.every( ( line ) => line.startsWith( ':' ) ) ) {
    return undefined
  }

  const data = lines.find( ( line ) => line.startsWith( 'data: ' ) )

  assert.ok( data, `frame has no data line: ${ JSON.stringify( frame ) }` )

  const payload: unknown = JSON.parse( data.slice( 'data: '.length ) )
  const idLine = lines.find( ( line ) => line.startsWith( 'id: ' ) )

  if( idLine === undefined ) {
    assert.equal( lines.length, 1, `a delta frame is one data line: ${ JSON.stringify( frame ) }` )

    return deltaEvent.parse( payload )
  }

  assert.equal( lines.length, 2, `a stored-event frame is an id line and a data line: ${ JSON.stringify( frame ) }` )

  const event = storedEvent.parse( payload )

  assert.equal( idLine, `id: ${ event.id }`, 'the frame id matches the event id' )

  return event
}

async function collect( lastEventId?: number ): Promise< Collector > {
  const controller = new AbortController()
  const response = await fetch( `${ baseUrl }/api/stream`, {
    headers: lastEventId === undefined ? {} : { 'Last-Event-ID': String( lastEventId ) },
    signal: AbortSignal.any( [ controller.signal, AbortSignal.timeout( 10 * 60 * 1000 ) ] ),
  } )

  assert.equal( response.status, 200, 'GET /api/stream returns 200' )
  assert.ok( response.body, 'GET /api/stream has a body' )

  const collector: Collector = {
    items: [],
    failure: undefined,
    stored: () => collector.items.filter( isStored ),
    deltas: () => collector.items.filter( ( item ): item is DeltaEvent => !isStored( item ) ),
    close: () => controller.abort(),
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  void ( async (): Promise< void > => {
    let buffer = ''

    try {
      for( ;; ) {
        const { done, value } = await reader.read()

        if( done ) {
          return
        }

        buffer += decoder.decode( value, { stream: true } )

        let end = buffer.indexOf( '\n\n' )

        while( end !== -1 ) {
          const item = parseFrame( buffer.slice( 0, end ) )

          if( item ) {
            collector.items.push( item )
          }

          buffer = buffer.slice( end + 2 )
          end = buffer.indexOf( '\n\n' )
        }
      }
    } catch( error ) {
      if( !controller.signal.aborted ) {
        collector.failure = error instanceof Error ? error : new Error( String( error ) )
      }
    }
  } )()

  return collector
}

async function waitHealthy(): Promise< void > {
  function probe(): Promise< boolean > {
    return fetch( `${ baseUrl }/api/health`, { signal: AbortSignal.timeout( 2_000 ) } ).then( ( response ) => response.ok, () => false )
  }

  let healthy = false
  const poller = setInterval( () => void probe().then( ( ok ) => {
    healthy = ok
  } ), 250 )

  try {
    await until( 'api to answer /api/health', () => healthy )
  } finally {
    clearInterval( poller )
  }
}

async function recoverStack(): Promise< void > {
  await compose( [ 'unpause', 'agents' ] ).catch( () => undefined )
  await compose( [ 'start', 'agents', 'api' ] )
  await waitHealthy()
}

async function createProject( name: string ): Promise< string > {
  const { project: created } = await request( 'POST', '/api/projects', projectEnvelope, { name } )

  return created.id
}

async function sendMessage( projectId: string, content: string ): Promise< number > {
  const { message } = await request( 'POST', `/api/projects/${ projectId }/messages`, messageEnvelope, { thread: 'pm', content } )

  return message.id
}

function eventsOf( events: StoredEvent[], projectId: string, type: StoredEvent[ 'type' ] ): StoredEvent[] {
  return events.filter( ( event ) => event.project_id === projectId && event.type === type )
}

function agentReplyDone( events: StoredEvent[], projectId: string ): boolean {
  return eventsOf( events, projectId, 'MessageCompleted' ).some( ( event ) => event.actor === 'pm' )
}

function claimedJobId( events: StoredEvent[], projectId: string ): number {
  const [ claimed ] = eventsOf( events, projectId, 'JobClaimed' )

  assert.equal( claimed.type, 'JobClaimed' )

  return claimed.payload.job_id
}

function lastStoredId( events: StoredEvent[] ): number {
  return events[ events.length - 1 ].id
}

async function scenarioStreaming(): Promise< void > {
  const projectId = await createProject( 'acceptance streaming' )
  const live = await collect()

  try {
    const humanMessageId = await sendMessage( projectId, 'I want to build a small app for tracking my reading list.' )

    await until( 'the PM reply to complete', () => agentReplyDone( live.stored(), projectId ), [ live ] )

    const jobId = claimedJobId( live.stored(), projectId )
    const deltas = live.deltas().filter( ( delta ) => delta.project_id === projectId )

    assert.ok( deltas.length > 0, 'at least one delta streamed' )
    assert.ok( deltas.every( ( delta ) => delta.job_id === jobId ), 'every delta carries the job id' )

    const firstDelta = live.items.findIndex( ( item ) => !isStored( item ) )
    const reply = live.items.findIndex( ( item ) => isStored( item ) && item.type === 'MessageCompleted' && item.actor === 'pm' )

    assert.ok( firstDelta !== -1 && firstDelta < reply, 'deltas arrive before the PM MessageCompleted' )

    const { messages } = await request( 'GET', `/api/projects/${ projectId }/threads/pm`, threadEnvelope )
    const replies = messages.filter( ( message ) => message.author === 'pm' )
    const completed = eventsOf( live.stored(), projectId, 'MessageCompleted' )

    assert.equal( replies.length, 1, 'one PM reply is stored' )
    assert.equal( replies[ 0 ].content, deltas.map( ( delta ) => delta.text ).join( '' ), 'the stored reply is the streamed text' )
    assert.deepEqual(
      completed.map( ( event ) => event.type === 'MessageCompleted' && event.payload.message_id ),
      [ humanMessageId, replies[ 0 ].id ],
      'MessageCompleted for the human message, then for the reply',
    )
  } finally {
    live.close()
  }
}

async function scenarioRestart(): Promise< void > {
  const projectId = await createProject( 'acceptance restart' )
  const before = await collect()
  let after: Collector | undefined

  try {
    await compose( [ 'pause', 'agents' ] )
    await sendMessage( projectId, 'Tell me what you need to know first.' )
    await until( 'the job to be claimed', () => eventsOf( before.stored(), projectId, 'JobClaimed' ).length === 1, [ before ] )

    // a paused agent service must hold the call open; a call that fails at once means the pause doesn't work here
    await sleep( holdMs )

    const held = before.stored().filter( ( event ) => event.project_id === projectId )

    assert.deepEqual( held.map( ( event ) => event.type ), [ 'MessageCompleted', 'JobClaimed' ], 'the job is still running while agents is paused' )

    const jobId = claimedJobId( held, projectId )
    const lastSeen = lastStoredId( before.stored() )

    before.close()
    await compose( [ 'kill', 'api' ] )
    await assert.rejects( fetch( `${ baseUrl }/api/health`, { signal: AbortSignal.timeout( 2_000 ) } ), 'api is down after the kill' )
    await compose( [ 'unpause', 'agents' ] )
    await compose( [ 'start', 'api' ] )
    await waitHealthy()

    after = await collect( lastSeen )

    const replay = after
    await until( 'the re-queued job to complete', () => agentReplyDone( replay.stored(), projectId ), [ replay ] )
    await sleep( settleMs )

    const history = [ ...before.stored(), ...after.stored() ].filter( ( event ) => event.project_id === projectId )
    const ids = history.map( ( event ) => event.id )

    assert.deepEqual( ids, [ ...ids ].sort( ( a, b ) => a - b ), 'event ids ascend' )
    assert.equal( new Set( ids ).size, ids.length, 'no event appears twice' )
    assert.deepEqual(
      eventsOf( history, projectId, 'JobClaimed' ).map( ( event ) => event.type === 'JobClaimed' && [ event.payload.job_id, event.payload.attempt ] ),
      [ [ jobId, 1 ], [ jobId, 2 ] ],
      'the job was claimed twice, attempts 1 and 2',
    )
    assert.equal( eventsOf( history, projectId, 'JobCompleted' ).length, 1, 'the job completed exactly once' )
    assert.equal( eventsOf( history, projectId, 'JobFailed' ).length, 0, 'the job did not fail' )
    assert.equal( eventsOf( history, projectId, 'MessageCompleted' ).filter( ( event ) => event.actor === 'pm' ).length, 1, 'one PM MessageCompleted' )

    const { messages } = await request( 'GET', `/api/projects/${ projectId }/threads/pm`, threadEnvelope )

    assert.equal( messages.filter( ( message ) => message.author === 'pm' ).length, 1, 'one PM reply is stored' )
  } finally {
    before.close()
    after?.close()
  }
}

async function scenarioReconnect(): Promise< void > {
  const projectId = await createProject( 'acceptance reconnect' )
  const control = await collect()
  const dropped = await collect()
  let reconnected: Collector | undefined

  try {
    await compose( [ 'pause', 'agents' ] )
    await sendMessage( projectId, 'What should we decide first?' )
    await until( 'the dropped stream to see the job claimed', () => eventsOf( dropped.stored(), projectId, 'JobClaimed' ).length === 1, [ control, dropped ] )

    const lastSeen = lastStoredId( dropped.stored() )

    dropped.close()
    await compose( [ 'unpause', 'agents' ] )
    await until( 'the reply to complete while the stream is down', () => agentReplyDone( control.stored(), projectId ), [ control ] )

    const missed = control.stored().filter( ( event ) => event.id > lastSeen )

    assert.ok( control.deltas().length > 0, 'deltas were published while the stream was down' )
    assert.deepEqual( missed.map( ( event ) => event.type ), [ 'MessageCompleted', 'JobCompleted' ], 'the reply and the job completion were missed' )

    reconnected = await collect( lastSeen )

    const replay = reconnected
    await until( 'the replay of the missed events', () => replay.stored().length >= missed.length, [ replay ] )
    await sleep( settleMs )

    assert.deepEqual( reconnected.stored(), missed, 'the reconnect replays exactly the missed stored events, once each, in order' )
    assert.equal( reconnected.deltas().length, 0, 'no delta is replayed' )
    assert.deepEqual( [ ...dropped.stored(), ...reconnected.stored() ], control.stored(), 'nothing is missing or duplicated across the drop' )
  } finally {
    control.close()
    dropped.close()
    reconnected?.close()
  }
}

const scenarios: Array< [ string, () => Promise< void > ] > = [
  [ 'a message streams deltas, then the PM MessageCompleted', scenarioStreaming ],
  [ 'killing api mid-job re-queues it and it completes exactly once', scenarioRestart ],
  [ 'reconnecting with Last-Event-ID replays exactly the missed events', scenarioReconnect ],
]

async function teardown(): Promise< void > {
  await compose( [ 'down', '--volumes', '--remove-orphans', '--timeout', '5' ] ).catch( ( error: unknown ) => {
    console.error( `teardown: ${ error instanceof Error ? error.message : String( error ) }` )
  } )
  await rm( dataDirectory, { recursive: true, force: true } )
}

async function main(): Promise< number > {
  let failed = 0

  process.once( 'SIGINT', () => {
    void ( keep ? Promise.resolve() : teardown() ).finally( () => process.exit( 130 ) )
  } )

  try {
    await teardown()
    await mkdir( dataDirectory, { recursive: true } )
    console.log( `starting ${ project } on port ${ port }` )
    // building is bounded separately: it is not a wait on the stack's state
    await compose( [ 'build' ], 10 * 60 * 1000 )
    await compose( [ 'up', '-d' ] )
    await waitHealthy()

    for( const [ name, scenario ] of scenarios ) {
      const started = Date.now()

      try {
        await recoverStack()
        await scenario()
        console.log( `PASS ${ name } (${ Math.round( ( Date.now() - started ) / 1000 ) } s)` )
      } catch( error ) {
        failed += 1
        console.error( `FAIL ${ name }\n${ error instanceof Error ? error.message : String( error ) }` )
        console.error( await compose( [ 'logs', '--no-color', '--tail', '30' ] ).catch( () => '(no logs)' ) )
      }
    }
  } catch( error ) {
    failed += 1
    console.error( `FAIL setup\n${ error instanceof Error ? error.message : String( error ) }` )
  } finally {
    if( keep ) {
      console.log( `--keep: the stack is up on port ${ port } and the data is in ${ dataDirectory }; stop it with docker compose -p ${ project } -f compose.yaml -f compose.acceptance.yaml down` )
    } else {
      await teardown()
    }
  }

  console.log( failed === 0 ? 'acceptance passed' : `acceptance failed: ${ failed }` )

  return failed === 0 ? 0 : 1
}

process.exitCode = await main()
