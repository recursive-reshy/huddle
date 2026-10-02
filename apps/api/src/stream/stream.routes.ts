// Express
import { Router } from 'express'
// Controllers
import { streamEvents } from './stream.controller.js'

export const streamRoutes: Router = Router()

streamRoutes.get( '/stream', streamEvents )
