// Packages
import { describe, expect, it } from 'vitest'
// Shared
import { jobKinds, jobKindOutputType, outputTypes } from './job-kinds.js'

describe( 'job kinds', () => {
  it( 'lists the nine job kinds', () => {
    expect( jobKinds ).toHaveLength( 9 )
  } )

  it( 'lists the five output types', () => {
    expect( [ ...outputTypes ].sort() ).toEqual( [ 'chat_reply', 'clarification', 'draft_artifact', 'review', 'summary' ] )
  } )

  it.each( [
    [ 'pm_discovery_reply', 'chat_reply' ],
    [ 'agent_chat_reply', 'chat_reply' ],
    [ 'pm_draft_brief', 'draft_artifact' ],
    [ 'pm_draft_prd', 'draft_artifact' ],
    [ 'sa_draft_trd', 'draft_artifact' ],
    [ 'revise_artifact', 'draft_artifact' ],
    [ 'sa_review_brief', 'review' ],
    [ 'clarification_round', 'clarification' ],
    [ 'loop_summary', 'summary' ],
  ] as const )( 'maps %s to %s', ( kind, outputType ) => {
    expect( jobKindOutputType[ kind ] ).toBe( outputType )
  } )

  it( 'maps every job kind', () => {
    expect( Object.keys( jobKindOutputType ).sort() ).toEqual( [ ...jobKinds ].sort() )
  } )

  it( 'uses every output type at least once', () => {
    expect( new Set( Object.values( jobKindOutputType ) ) ).toEqual( new Set( outputTypes ) )
  } )
} )
