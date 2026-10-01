// Config
import { prices } from '#src/config.js'

export interface Usage {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

const perMillion = 1_000_000

function safe( value: number, label: string ): number {
  if( !Number.isSafeInteger( value ) ) {
    throw new Error( `${ label } is not a safe integer: ${ value }` )
  }

  return value
}

function tokens( value: number, label: string ): number {
  if( !Number.isSafeInteger( value ) || value < 0 ) {
    throw new Error( `${ label } must be a non-negative integer, got ${ value }` )
  }

  return value
}

export function costMicroUsd( usage: Usage ): number {
  if( !Object.hasOwn( prices, usage.model ) ) {
    throw new Error( `no price for model ${ usage.model }` )
  }

  const price = prices[ usage.model ]
  const parts = [
    safe( tokens( usage.input_tokens, 'input_tokens' ) * price.input, 'input cost' ),
    safe( tokens( usage.output_tokens, 'output_tokens' ) * price.output, 'output cost' ),
    safe( tokens( usage.cache_write_tokens, 'cache_write_tokens' ) * price.cache_write, 'cache write cost' ),
    safe( tokens( usage.cache_read_tokens, 'cache_read_tokens' ) * price.cache_read, 'cache read cost' ),
  ]

  // Integer arithmetic throughout: the one rounding is half up, and % on safe integers is exact.
  const total = safe( parts.reduce( ( sum, part ) => sum + part, 0 ) + perMillion / 2, 'total cost' )

  return ( total - total % perMillion ) / perMillion
}
