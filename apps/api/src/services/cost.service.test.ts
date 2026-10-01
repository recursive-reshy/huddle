// Packages
import { describe, expect, it } from 'vitest'
// Services
import { costMicroUsd } from './cost.service.js'

const none = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }

describe( 'costMicroUsd', () => {
  it( 'is 0 for a call with no tokens', () => {
    expect( costMicroUsd( { model: 'claude-sonnet-5-5', ...none } ) ).toBe( 0 )
  } )

  it( 'prices sonnet input and output', () => {
    expect( costMicroUsd( { model: 'claude-sonnet-5-5', ...none, input_tokens: 1_000, output_tokens: 500 } ) ).toBe( 7_000 )
  } )

  it( 'prices sonnet cache writes and reads', () => {
    expect( costMicroUsd( { model: 'claude-sonnet-5-5', ...none, cache_write_tokens: 10_000, cache_read_tokens: 100_000 } ) ).toBe( 45_000 )
  } )

  it( 'prices haiku', () => {
    expect( costMicroUsd( { model: 'claude-haiku-4-5-20251001', ...none, input_tokens: 2_000, output_tokens: 300 } ) ).toBe( 3_500 )
  } )

  it( 'prices one million input tokens at the table price', () => {
    expect( costMicroUsd( { model: 'claude-sonnet-5-5', ...none, input_tokens: 1_000_000 } ) ).toBe( 2_000_000 )
  } )

  it( 'prices fake at 0 whatever the tokens', () => {
    expect( costMicroUsd( { model: 'fake', input_tokens: 9_000, output_tokens: 9_000, cache_read_tokens: 9_000, cache_write_tokens: 9_000 } ) ).toBe( 0 )
  } )

  it( 'rounds below a half down', () => {
    expect( costMicroUsd( { model: 'claude-haiku-4-5-20251001', ...none, cache_read_tokens: 4 } ) ).toBe( 0 )
  } )

  it( 'rounds exactly a half up', () => {
    expect( costMicroUsd( { model: 'claude-haiku-4-5-20251001', ...none, cache_read_tokens: 5 } ) ).toBe( 1 )
  } )

  it( 'rounds above a half up', () => {
    expect( costMicroUsd( { model: 'claude-sonnet-5-5', ...none, cache_read_tokens: 3 } ) ).toBe( 1 )
  } )

  it( 'rounds once per call, not once per token type', () => {
    // 2.5 + 0.6 = 3.1 → 3; rounding each part first would give 3 + 1 = 4
    expect( costMicroUsd( { model: 'claude-sonnet-5-5', ...none, cache_write_tokens: 1, cache_read_tokens: 3 } ) ).toBe( 3 )
  } )

  it( 'returns a safe integer', () => {
    const cost = costMicroUsd( { model: 'claude-sonnet-5-5', ...none, input_tokens: 123_457, output_tokens: 7_891 } )

    expect( Number.isSafeInteger( cost ) ).toBe( true )
  } )

  it( 'throws on a model that has no price, so billed spend is never recorded as $0', () => {
    expect( () => costMicroUsd( { model: 'claude-unknown', ...none, input_tokens: 1 } ) ).toThrow( /claude-unknown/ )
  } )

  it( 'does not read a model name off the prototype', () => {
    expect( () => costMicroUsd( { model: 'constructor', ...none } ) ).toThrow( /constructor/ )
  } )

  it.each( [
    [ 'negative', -1 ],
    [ 'fractional', 1.5 ],
    [ 'NaN', Number.NaN ],
    [ 'infinite', Number.POSITIVE_INFINITY ],
  ] )( 'throws on a %s token count', ( _name, count ) => {
    expect( () => costMicroUsd( { model: 'claude-sonnet-5-5', ...none, input_tokens: count } ) ).toThrow( /input_tokens/ )
  } )

  it( 'throws when a product leaves the safe-integer range', () => {
    expect( () => costMicroUsd( { model: 'claude-sonnet-5-5', ...none, input_tokens: 5_000_000_000 } ) ).toThrow( /safe integer/ )
  } )

  it( 'throws when the sum leaves the safe-integer range', () => {
    expect( () => costMicroUsd( { model: 'claude-sonnet-5-5', ...none, input_tokens: 2_000_000_000, output_tokens: 700_000_000, cache_write_tokens: 1_000_000_000 } ) ).toThrow( /safe integer/ )
  } )
} )
