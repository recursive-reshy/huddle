// Packages
import { sql } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
// Shared
import { jobKinds, projectStates } from '@my-team/shared'

const epochMs = sql`(CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))`

export const eventTypes = [
  'StateTransitioned', 'GateSentBack', 'JobClaimed', 'JobCompleted', 'JobFailed', 'MessageCompleted',
  'ArtifactVersionCreated', 'ArtifactVersionApproved', 'ClarificationAsked', 'ClarificationAnswered',
  'ClarificationEscalated', 'DecisionRecorded',
] as const

export type EventType = typeof eventTypes[ number ]

export const agents = sqliteTable( 'agents', {
  id: text( 'id' ).primaryKey(),
  name: text( 'name' ).notNull(),
} )

export const projects = sqliteTable( 'projects', {
  id: text( 'id' ).primaryKey(),
  name: text( 'name' ).notNull(),
  current_state: text( 'current_state', { enum: projectStates } ).notNull(),
  state_rev: integer( 'state_rev' ).notNull().default( 0 ),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
  updated_at: integer( 'updated_at' ).notNull().default( epochMs ),
} )

export const artifacts = sqliteTable( 'artifacts', {
  id: text( 'id' ).primaryKey(),
  project_id: text( 'project_id' ).notNull(),
  kind: text( 'kind', { enum: [ 'brief', 'prd', 'trd' ] } ).notNull(),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
} )

export const artifact_versions = sqliteTable( 'artifact_versions', {
  artifact_id: text( 'artifact_id' ).notNull(),
  version: integer( 'version' ).notNull(),
  parent_version: integer( 'parent_version' ),
  status: text( 'status', { enum: [ 'draft', 'approved', 'superseded', 'discarded' ] } ).notNull().default( 'draft' ),
  created_by: text( 'created_by' ).notNull(),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
  approved_at: integer( 'approved_at' ),
}, ( table ) => [
  primaryKey( { columns: [ table.artifact_id, table.version ] } ),
] )

export const artifact_sections = sqliteTable( 'artifact_sections', {
  artifact_id: text( 'artifact_id' ).notNull(),
  version: integer( 'version' ).notNull(),
  section_key: text( 'section_key' ).notNull(),
  ordinal: integer( 'ordinal' ).notNull(),
  title: text( 'title' ).notNull(),
  content: text( 'content' ).notNull(),
  author: text( 'author' ).notNull(),
}, ( table ) => [
  primaryKey( { columns: [ table.artifact_id, table.version, table.section_key ] } ),
] )

export const jobs = sqliteTable( 'jobs', {
  id: integer( 'id' ).primaryKey( { autoIncrement: true } ),
  project_id: text( 'project_id' ).notNull(),
  kind: text( 'kind', { enum: jobKinds } ).notNull(),
  agent: text( 'agent' ).notNull(),
  status: text( 'status', { enum: [ 'queued', 'running', 'succeeded', 'failed', 'cancelled' ] } ).notNull().default( 'queued' ),
  input: text( 'input', { mode: 'json' } ).$type< Record< string, unknown > >().notNull().default( sql`'{}'` ),
  result: text( 'result', { mode: 'json' } ).$type< Record< string, unknown > >(),
  error: text( 'error' ),
  attempts: integer( 'attempts' ).notNull().default( 0 ),
  max_attempts: integer( 'max_attempts' ).notNull().default( 3 ),
  run_after: integer( 'run_after' ).notNull().default( epochMs ),
  locked_at: integer( 'locked_at' ),
  lease_expires_at: integer( 'lease_expires_at' ),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
  finished_at: integer( 'finished_at' ),
} )

export const messages = sqliteTable( 'messages', {
  id: integer( 'id' ).primaryKey( { autoIncrement: true } ),
  project_id: text( 'project_id' ).notNull(),
  thread: text( 'thread' ).notNull(),
  author: text( 'author' ).notNull(),
  kind: text( 'kind', { enum: [ 'chat', 'discussion', 'summary', 'system' ] } ).notNull(),
  content: text( 'content' ).notNull(),
  job_id: integer( 'job_id' ),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
} )

export const events = sqliteTable( 'events', {
  id: integer( 'id' ).primaryKey( { autoIncrement: true } ),
  project_id: text( 'project_id' ).notNull(),
  type: text( 'type', { enum: eventTypes } ).notNull(),
  actor: text( 'actor' ),
  payload: text( 'payload', { mode: 'json' } ).$type< Record< string, unknown > >().notNull().default( sql`'{}'` ),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
} )

export const clarifications = sqliteTable( 'clarifications', {
  id: text( 'id' ).primaryKey(),
  project_id: text( 'project_id' ).notNull(),
  thread_id: text( 'thread_id' ).notNull(),
  round: integer( 'round' ).notNull(),
  from_agent: text( 'from_agent' ).notNull(),
  to_agent: text( 'to_agent' ).notNull(),
  question: text( 'question' ).notNull(),
  status: text( 'status', { enum: [ 'open', 'answered', 'deferred', 'escalated' ] } ).notNull().default( 'open' ),
  answer: text( 'answer' ),
  answered_by: text( 'answered_by' ),
  artifact_id: text( 'artifact_id' ),
  artifact_version: integer( 'artifact_version' ),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
  answered_at: integer( 'answered_at' ),
} )

export const decisions = sqliteTable( 'decisions', {
  id: text( 'id' ).primaryKey(),
  project_id: text( 'project_id' ).notNull(),
  title: text( 'title' ).notNull(),
  decision: text( 'decision' ).notNull(),
  rationale: text( 'rationale' ).notNull(),
  decided_by: text( 'decided_by' ).notNull(),
  supersedes: text( 'supersedes' ),
  artifact_id: text( 'artifact_id' ),
  artifact_version: integer( 'artifact_version' ),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
} )

export const llm_calls = sqliteTable( 'llm_calls', {
  id: integer( 'id' ).primaryKey(),
  project_id: text( 'project_id' ),
  job_id: integer( 'job_id' ),
  agent: text( 'agent' ).notNull(),
  model: text( 'model' ).notNull(),
  input_tokens: integer( 'input_tokens' ).notNull().default( 0 ),
  output_tokens: integer( 'output_tokens' ).notNull().default( 0 ),
  cache_read_tokens: integer( 'cache_read_tokens' ).notNull().default( 0 ),
  cache_write_tokens: integer( 'cache_write_tokens' ).notNull().default( 0 ),
  cost_micro_usd: integer( 'cost_micro_usd' ).notNull(),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
} )

export const backups = sqliteTable( 'backups', {
  id: integer( 'id' ).primaryKey(),
  created_at: integer( 'created_at' ).notNull().default( epochMs ),
  bytes: integer( 'bytes' ).notNull(),
  sha256: text( 'sha256' ).notNull(),
} )

export type EventRow = typeof events.$inferSelect
export type JobRow = typeof jobs.$inferSelect
