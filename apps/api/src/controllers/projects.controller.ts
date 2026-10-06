// Express
import type { Request, Response } from 'express'
// Shared
import { createProjectBody } from '@huddle/shared'
// Services
import { createProject, getProject, listAllProjects } from '#src/services/projects.service.js'

export function postProject( { app, body }: Request, res: Response ): void {
  const { db, bus } = app.locals
  const { name } = createProjectBody.parse( body )

  const project = createProject( db, bus, { name } )

  res.status( 201 ).json( { project } )
}

export function listProjects( { app }: Request, res: Response ): void {
  const projects = listAllProjects( app.locals.db )

  res.status( 200 ).json( { projects } )
}

export function readProject( { app, params }: Request, res: Response ): void {
  const project = getProject( app.locals.db, String( params.projectId ) )

  res.status( 200 ).json( { project } )
}
