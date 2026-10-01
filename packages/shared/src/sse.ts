// Packages
import { z } from 'zod'
// Shared
import { agentId } from './ids.js'
import { projectState } from './rest.js'

const jobClaimed = z.strictObject( { job_id: z.number().int(), attempt: z.number().int().gte( 1 ) } )
const jobCompleted = z.strictObject( { job_id: z.number().int() } )
const jobFailed = z.strictObject( { job_id: z.number().int(), error: z.string() } )
const messageCompleted = z.strictObject( { message_id: z.number().int() } )
// cancelled_job_ids arrives in 1.2
const stateTransitioned = z.strictObject( { from: projectState, to: projectState, trigger: z.string(), state_rev: z.number().int().gte( 0 ) } )

const envelope = {
  id: z.number().int().gte( 1 ),
  project_id: z.string(),
  actor: agentId.nullable(),
  created_at: z.number().int(),
}

export const storedEvent = z.discriminatedUnion( 'type', [
  z.strictObject( { ...envelope, type: z.literal( 'JobClaimed' ), payload: jobClaimed } ),
  z.strictObject( { ...envelope, type: z.literal( 'JobCompleted' ), payload: jobCompleted } ),
  z.strictObject( { ...envelope, type: z.literal( 'JobFailed' ), payload: jobFailed } ),
  z.strictObject( { ...envelope, type: z.literal( 'MessageCompleted' ), payload: messageCompleted } ),
  z.strictObject( { ...envelope, type: z.literal( 'StateTransitioned' ), payload: stateTransitioned } ),
] )
export type StoredEvent = z.infer< typeof storedEvent >

export const deltaEvent = z.strictObject( { project_id: z.string(), job_id: z.number().int(), text: z.string().min( 1 ) } )
export type DeltaEvent = z.infer< typeof deltaEvent >
