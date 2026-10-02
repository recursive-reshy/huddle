// Packages
import { and, asc, eq } from 'drizzle-orm'
// Shared
import { messageResponse, type MessageResponse, type ThreadId } from '@my-team/shared'
// DB
import type { Db } from '#src/db/connection.js'
import type { Tx } from '#src/db/transaction.js'
import { messages } from '#src/db/schema.js'

const messageColumns = {
  id: messages.id,
  project_id: messages.project_id,
  thread: messages.thread,
  author: messages.author,
  kind: messages.kind,
  content: messages.content,
  created_at: messages.created_at,
}

type NewMessage = Pick< MessageResponse, 'project_id' | 'thread' | 'author' | 'kind' | 'content' >

export function insertMessage( tx: Tx, newMessage: NewMessage ): MessageResponse {
  return messageResponse.parse( tx.insert( messages ).values( newMessage ).returning( messageColumns ).get() )
}

export function listThreadMessages( db: Db, { project_id, thread }: { project_id: string, thread: ThreadId } ): MessageResponse[] {
  const rows = db.select( messageColumns ).from( messages )
    .where( and( eq( messages.project_id, project_id ), eq( messages.thread, thread ) ) )
    .orderBy( asc( messages.id ) )
    .all()

  return messageResponse.array().parse( rows )
}
