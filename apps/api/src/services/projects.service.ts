// Packages
import { monotonicFactory } from 'ulid'
// Shared
import type { ProjectResponse } from '@huddle/shared'
// Bus
import type { Bus } from '#src/bus/bus.js'
// DB
import type { Db } from '#src/db/connection.js'
import { writeTransaction } from '#src/db/transaction.js'
// Errors
import { NotFoundError } from '#src/errors.js'
// Repositories
import { findProject, insertProject, listProjects } from '#src/repositories/projects.repository.js'

// monotonic, so two projects made in the same millisecond still sort in creation order
const newId = monotonicFactory()

export function createProject( db: Db, bus: Bus, { name }: { name: string } ): ProjectResponse {
  return writeTransaction( db, bus, ( tx ) => insertProject( tx, { id: newId(), name } ) )
}

export function listAllProjects( db: Db ): ProjectResponse[] {
  return listProjects( db )
}

export function getProject( db: Db, id: string ): ProjectResponse {
  const project = findProject( db, id )

  if( !project ) {
    throw new NotFoundError( `Project ${ id } not found` )
  }

  return project
}
