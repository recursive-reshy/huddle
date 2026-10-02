// Packages
import { describe, expect, it } from 'vitest'
// Logger
import { createLogger, logger } from './logger.js'

describe( 'createLogger', () => {
  it( 'defaults to info', () => {
    expect( createLogger( {} ).level ).toBe( 'info' )
  } )

  it( 'takes its level from LOG_LEVEL', () => {
    expect( createLogger( { LOG_LEVEL: 'debug' } ).level ).toBe( 'debug' )
  } )

  it( 'is silent under test', () => {
    expect( createLogger( { NODE_ENV: 'test' } ).level ).toBe( 'silent' )
  } )

  it( 'lets LOG_LEVEL win under test, so a failing test can be debugged', () => {
    expect( createLogger( { NODE_ENV: 'test', LOG_LEVEL: 'trace' } ).level ).toBe( 'trace' )
  } )
} )

describe( 'logger', () => {
  it( 'is silent in this test run', () => {
    expect( logger.level ).toBe( 'silent' )
  } )
} )
