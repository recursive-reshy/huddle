// Packages
import { z } from 'zod'
// Shared
import { agentId, threadId } from './ids.js'

export const projectStates = [ 'DISCOVERY', 'BRIEF_DRAFT', 'GATE_BRIEF', 'SA_REVIEW', 'PRD_DRAFT', 'GATE_PRD', 'TRD_DRAFT', 'GATE_TRD', 'DONE', 'ESCALATED' ] as const
export const projectState = z.enum( projectStates )
export type ProjectState = z.infer< typeof projectState >

export const messageKind = z.enum( [ 'chat', 'discussion', 'summary', 'system' ] )
export type MessageKind = z.infer< typeof messageKind >

export const createProjectBody = z.strictObject( { name: z.string().min( 1 ) } )
export type CreateProjectBody = z.infer< typeof createProjectBody >

export const postMessageBody = z.strictObject( { thread: threadId, content: z.string().min( 1 ) } )
export type PostMessageBody = z.infer< typeof postMessageBody >

export const projectResponse = z.strictObject( {
  id: z.string(),
  name: z.string(),
  current_state: projectState,
  state_rev: z.number().int().gte( 0 ),
  latest_event_id: z.number().int().gte( 0 ),
} )
export type ProjectResponse = z.infer< typeof projectResponse >

export const messageResponse = z.strictObject( {
  id: z.number().int().gte( 1 ),
  project_id: z.string(),
  thread: threadId,
  author: agentId,
  kind: messageKind,
  content: z.string(),
  created_at: z.number().int(),
} )
export type MessageResponse = z.infer< typeof messageResponse >

export const threadResponse = z.strictObject( { messages: z.array( messageResponse ) } )
export type ThreadResponse = z.infer< typeof threadResponse >

export const projectEnvelope = z.strictObject( { project: projectResponse } )
export type ProjectEnvelope = z.infer< typeof projectEnvelope >

export const projectsEnvelope = z.strictObject( { projects: z.array( projectResponse ) } )
export type ProjectsEnvelope = z.infer< typeof projectsEnvelope >

export const messageEnvelope = z.strictObject( { message: messageResponse } )
export type MessageEnvelope = z.infer< typeof messageEnvelope >

export const threadEnvelope = z.strictObject( { project_id: z.string(), thread: threadId, messages: z.array( messageResponse ) } )
export type ThreadEnvelope = z.infer< typeof threadEnvelope >

export const errorResponse = z.strictObject( { error: z.string() } )
export type ErrorResponse = z.infer< typeof errorResponse >
