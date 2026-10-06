// Packages
import { desc, eq, sql } from 'drizzle-orm'
// Shared
import type { ProjectResponse } from '@huddle/shared'
// DB
import type { Db } from '#src/db/connection.js'
import type { Tx } from '#src/db/transaction.js'
import { projects } from '#src/db/schema.js'

const projectColumns = {
  id: projects.id,
  name: projects.name,
  current_state: projects.current_state,
  state_rev: projects.state_rev,
  // written out because drizzle drops table qualifiers in a single-table select, which would make the two ids ambiguous
  latest_event_id: sql< number >`coalesce( ( select max( e.id ) from events e where e.project_id = projects.id ), 0 )`,
}

export function insertProject( tx: Tx, { id, name }: { id: string, name: string } ): ProjectResponse {
  tx.insert( projects ).values( { id, name, current_state: 'DISCOVERY' } ).run()

  return tx.select( projectColumns ).from( projects ).where( eq( projects.id, id ) ).get()!
}

export function findProject( db: Db | Tx, id: string ): ProjectResponse | undefined {
  return db.select( projectColumns ).from( projects ).where( eq( projects.id, id ) ).get()
}

export function listProjects( db: Db ): ProjectResponse[] {
  return db.select( projectColumns ).from( projects ).orderBy( desc( projects.created_at ), desc( projects.id ) ).all()
}
