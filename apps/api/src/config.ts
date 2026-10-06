// Packages
import path from 'node:path'
import { z } from 'zod'
// Shared
import type { JobKind } from '@huddle/shared'

const Env = z.object( {
  DATABASE_FILE: z.string().min( 1 ),
  MIGRATIONS_DIR: z.string().min( 1 ),
  AGENTS_URL: z.url().default( 'http://localhost:8000' ),
} )

const sonnet = 'claude-sonnet-5-5'
const haiku = 'claude-haiku-4-5-20251001'

export const models: Record< JobKind, string > = {
  pm_discovery_reply: sonnet,
  agent_chat_reply: sonnet,
  pm_draft_brief: sonnet,
  sa_review_brief: sonnet,
  pm_draft_prd: sonnet,
  sa_draft_trd: sonnet,
  revise_artifact: sonnet,
  clarification_round: sonnet,
  loop_summary: haiku,
}

export interface Price {
  input: number
  output: number
  cache_write: number
  cache_read: number
}

// Micro-dollars per million tokens, checked 2 Oct 2026 against the 5-minute cache TTL.
// The 1-hour TTL would make cache_write 4_000_000 (sonnet) and 2_000_000 (haiku).
export const prices: Record< string, Price > = {
  [ sonnet ]: { input: 2_000_000, output: 10_000_000, cache_write: 2_500_000, cache_read: 200_000 },
  [ haiku ]: { input: 1_000_000, output: 5_000_000, cache_write: 1_250_000, cache_read: 100_000 },
  fake: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
}

export const recentMessages = 20

export interface Config {
  databaseFile: string
  migrationsDir: string
  snapshotDir: string
  leaseMs: number
  agentsUrl: string
  stepIdleMs: number
  stepTotalMs: number
}

export function loadConfig( env: NodeJS.ProcessEnv ): Config {
  const { DATABASE_FILE, MIGRATIONS_DIR, AGENTS_URL } = Env.parse( env )

  return {
    databaseFile: DATABASE_FILE,
    migrationsDir: MIGRATIONS_DIR,
    snapshotDir: path.join( path.dirname( DATABASE_FILE ), 'snapshots' ),
    leaseMs: 15 * 60 * 1000,
    agentsUrl: AGENTS_URL,
    stepIdleMs: 60_000,
    stepTotalMs: 10 * 60 * 1000,
  }
}
