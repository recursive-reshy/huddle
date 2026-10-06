// Express
import type { Request, Response } from 'express'
// Shared
import { postMessageBody, threadId } from '@huddle/shared'
// Current user
import { currentUser } from '#src/current-user.js'
// Services
import { getThread, sendMessage } from '#src/services/messages.service.js'

export function postMessage( req: Request, res: Response ): void {
  const { app, params, body } = req
  const { db, bus } = app.locals
  const projectId = String( params.projectId )
  const { thread, content } = postMessageBody.parse( body )

  const message = sendMessage( db, bus, { projectId, thread, content, author: currentUser( req ).agent_id } )

  res.status( 201 ).json( { message } )
}

export function listThread( { app, params }: Request, res: Response ): void {
  const projectId = String( params.projectId )
  const agent = threadId.parse( params.agent )

  const messages = getThread( app.locals.db, { projectId, agent } )

  res.status( 200 ).json( { project_id: projectId, thread: agent, messages } )
}
