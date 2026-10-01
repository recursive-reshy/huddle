// Packages
import { jsonSchemaToZod } from 'json-schema-to-zod'

type Definitions = Record< string, unknown >

function isRecord( value: unknown ): value is Record< string, unknown > {
  return typeof value === 'object' && value !== null && !Array.isArray( value )
}

// json-schema-to-zod does not resolve $ref, so every reference is inlined here
function inlineRefs( node: unknown, definitions: Definitions, trail: string[] ): unknown {
  if( Array.isArray( node ) ) {
    return node.map( ( item ) => inlineRefs( item, definitions, trail ) )
  }

  if( !isRecord( node ) ) {
    return node
  }

  if( typeof node.$ref === 'string' ) {
    const name = node.$ref.replace( '#/$defs/', '' )

    if( trail.includes( name ) ) {
      throw new Error( `circular $ref: ${ [ ...trail, name ].join( ' -> ' ) }` )
    }

    if( !( name in definitions ) ) {
      throw new Error( `$ref points at ${ name }, which is not in $defs` )
    }

    return inlineRefs( definitions[ name ], definitions, [ ...trail, name ] )
  }

  return Object.fromEntries( Object.entries( node ).map( ( [ key, value ] ) => [ key, inlineRefs( value, definitions, trail ) ] ) )
}

function schemaFor( definitions: Definitions, name: string ): string {
  if( !( name in definitions ) ) {
    throw new Error( `$defs has no ${ name }` )
  }

  const inlined = inlineRefs( definitions[ name ], definitions, [ name ] )

  if( !isRecord( inlined ) ) {
    throw new Error( `${ name } is not a schema object` )
  }

  return jsonSchemaToZod( inlined, { zodVersion: 4 } )
}

export function renderStepContract( exported: unknown ): string {
  if( !isRecord( exported ) || !isRecord( exported.$defs ) ) {
    throw new Error( 'the step contract export has no $defs' )
  }

  const definitions = exported.$defs

  return [
    '// Generated from services/agents/schema/step_contract.json by `pnpm generate`. Do not edit.',
    'import { z } from \'zod\'',
    '',
    `export const stepLine = ${ schemaFor( definitions, 'StepLine' ) }`,
    '',
    `export const stepRequest = ${ schemaFor( definitions, 'StepRequest' ) }`,
    '',
    'export type StepLine = z.infer< typeof stepLine >',
    'export type StepRequest = z.infer< typeof stepRequest >',
    '',
  ].join( '\n' )
}
