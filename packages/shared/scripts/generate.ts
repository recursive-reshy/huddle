// Node
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Scripts
import { renderStepContract } from './render.js'

const schemaPath = fileURLToPath( new URL( '../../../services/agents/schema/step_contract.json', import.meta.url ) )
const outputPath = fileURLToPath( new URL( '../src/generated/step-contract.ts', import.meta.url ) )

writeFileSync( outputPath, renderStepContract( JSON.parse( readFileSync( schemaPath, 'utf8' ) ) ) )
