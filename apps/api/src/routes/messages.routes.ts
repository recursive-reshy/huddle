// Express
import { Router } from 'express'
// Controllers
import { listThread, postMessage } from '#src/controllers/messages.controller.js'

export const messagesRoutes: Router = Router()

messagesRoutes.post( '/projects/:projectId/messages', postMessage )
messagesRoutes.get( '/projects/:projectId/threads/:agent', listThread )
