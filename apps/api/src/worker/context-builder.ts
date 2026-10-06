// Packages
import { z } from 'zod'
// Shared
import type { StepRequest } from '@huddle/shared'
// Config
import { recentMessages } from '#src/config.js'
// DB
import type { Db } from '#src/db/connection.js'
import type { JobRow } from '#src/db/schema.js'
// Services
import { listRecentChat } from '#src/services/messages.service.js'
import { getProject } from '#src/services/projects.service.js'

const discoveryInput = z.object( { message_id: z.number().int().gte( 1 ) } )

export function buildDiscoveryReplyContext( db: Db, job: JobRow ): StepRequest[ 'context' ] {
  const { message_id } = discoveryInput.parse( job.input )
  const { id, name } = getProject( db, job.project_id )
  const window = listRecentChat( db, { projectId: job.project_id, thread: 'pm', upToMessageId: message_id, limit: recentMessages } )

  return {
    project: { id, name },
    artifacts: [],
    decisions: [],
    draft: [],
    questions: [],
    messages: window.map( ( { author, kind, content } ) => ( { author, kind, content } ) ),
    task: { notes: '', mode: 'normal', may_ask: false },
  }
}
