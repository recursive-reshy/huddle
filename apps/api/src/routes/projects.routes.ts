// Express
import { Router } from 'express'
// Controllers
import { listProjects, postProject, readProject } from '#src/controllers/projects.controller.js'

export const projectsRoutes: Router = Router()

projectsRoutes.post( '/projects', postProject )
projectsRoutes.get( '/projects', listProjects )
projectsRoutes.get( '/projects/:projectId', readProject )
