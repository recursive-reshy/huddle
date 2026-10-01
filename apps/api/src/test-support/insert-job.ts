// Packages
import { eq } from 'drizzle-orm'
// DB
import type { Db } from '#src/db/connection.js'
import { jobs, projects, type JobRow } from '#src/db/schema.js'

export function insertProject( db: Db, id = 'p1' ): void {
  db.insert( projects ).values( { id, name: id, current_state: 'DISCOVERY' } ).onConflictDoNothing().run()
}

export function insertJob( db: Db, overrides: Partial< typeof jobs.$inferInsert > = {} ): JobRow {
  const project_id = overrides.project_id ?? 'p1'

  insertProject( db, project_id )

  return db.insert( jobs ).values( { project_id, kind: 'pm_discovery_reply', agent: 'pm', run_after: 0, ...overrides } ).returning().get()
}

export function readJob( db: Db, id: number ): JobRow {
  return db.select().from( jobs ).where( eq( jobs.id, id ) ).get()!
}
