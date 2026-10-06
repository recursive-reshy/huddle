// Express
import type { Request } from 'express'
// Shared
import type { AgentId } from '@huddle/shared'

// the one place that decides who is acting; this single-user app always answers the human, so the request is not read yet
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function currentUser( _req: Request ): { agent_id: AgentId } {
  return { agent_id: 'human' }
}
