// Shared
import type { AgentId, MessageResponse, ThreadId } from '@my-team/shared'
// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from '#src/db/connection.js'
import type { EventRow, JobRow } from '#src/db/schema.js'
import { writeTransaction, type Tx } from '#src/db/transaction.js'
// Errors
import { ConflictError, NotFoundError } from '#src/errors.js'
// Repositories
import { appendEvent } from '#src/repositories/events.repository.js'
import { enqueueJob, hasReplyInFlight } from '#src/repositories/jobs.repository.js'
import { insertMessage, listRecentMessages, listThreadMessages } from '#src/repositories/messages.repository.js'
import { findProject } from '#src/repositories/projects.repository.js'
// Services
import { getProject } from './projects.service.js'

export function listRecentChat( db: Db, { projectId, thread, upToMessageId, limit }: { projectId: string, thread: ThreadId, upToMessageId: number, limit: number } ): MessageResponse[] {
  return listRecentMessages( db, { project_id: projectId, thread, kind: 'chat', up_to_id: upToMessageId, limit } )
}

// runs inside the job's finishing transaction, so the message and its event land or roll back with the job result
export function recordAgentReply( tx: Tx, events: EventRow[], { job, content }: { job: JobRow, content: string } ): MessageResponse {
  const message = insertMessage( tx, { project_id: job.project_id, thread: 'pm', author: 'pm', kind: 'chat', content, job_id: job.id } )

  events.push( appendEvent( tx, { project_id: job.project_id, type: 'MessageCompleted', actor: 'pm', payload: { message_id: message.id } } ) )

  return message
}

export function sendMessage( db: Db, bus: Bus, { projectId, thread, content, author }: { projectId: string, thread: ThreadId, content: string, author: AgentId } ): MessageResponse {
  return writeTransaction( db, bus, ( tx, events ) => {
    const project = findProject( tx, projectId )

    if( !project ) {
      throw new NotFoundError( `Project ${ projectId } not found` )
    }

    // gates and ESCALATED open the sa thread and agent_chat_reply later; for now only the pm thread in DISCOVERY takes messages
    if( project.current_state !== 'DISCOVERY' || thread !== 'pm' ) {
      throw new ConflictError( `The ${ thread } thread does not accept messages in ${ project.current_state }` )
    }

    if( hasReplyInFlight( tx, { project_id: projectId, agent: thread } ) ) {
      throw new ConflictError( `A reply on the ${ thread } thread is still in progress` )
    }

    const message = insertMessage( tx, { project_id: projectId, thread, author, kind: 'chat', content } )

    events.push( appendEvent( tx, { project_id: projectId, type: 'MessageCompleted', actor: author, payload: { message_id: message.id } } ) )
    enqueueJob( tx, { project_id: projectId, kind: 'pm_discovery_reply', agent: thread, input: { message_id: message.id } } )

    return message
  } )
}

export function getThread( db: Db, { projectId, agent }: { projectId: string, agent: ThreadId } ): MessageResponse[] {
  getProject( db, projectId )

  return listThreadMessages( db, { project_id: projectId, thread: agent } )
}
