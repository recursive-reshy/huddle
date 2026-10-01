// Packages
import { is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// DB
import * as schema from './schema.js'
// Test support
import { createTempDatabase, type TempDatabase } from '#src/test-support/temp-database.js'

interface ColumnInfo {
  name: string
  type: string
  notnull: boolean
  pk: boolean
  hasDefault: boolean
}

const tables = ( Object.values( schema ) as unknown[] ).filter( ( value ): value is SQLiteTable => is( value, SQLiteTable ) )

let temp: TempDatabase

beforeEach( () => {
  temp = createTempDatabase()
} )

afterEach( () => {
  temp.cleanup()
} )

function declared( table: SQLiteTable ): ColumnInfo[] {
  const { columns, primaryKeys } = getTableConfig( table )

  return columns.map( ( column ) => {
    const pk = column.primary || primaryKeys.some( ( key ) => key.columns.includes( column ) )

    // Drizzle flags a rowid primary key as defaulted; SQLite reports no default for it
    return { name: column.name, type: column.getSQLType(), notnull: column.notNull, pk, hasDefault: column.hasDefault && !pk }
  } )
}

function actual( name: string ): ColumnInfo[] {
  const rows = temp.db.$client.pragma( `table_info( ${ name } )` ) as { name: string, type: string, notnull: number, pk: number, dflt_value: string | null }[]

  return rows.map( ( row ) => ( {
    name: row.name,
    type: row.type.toLowerCase(),
    notnull: row.notnull === 1,
    pk: row.pk > 0,
    hasDefault: row.dflt_value !== null,
  } ) )
}

describe( 'drizzle schema', () => {
  it( 'covers exactly the 12 tables from migration 0001', () => {
    const rows = temp.db.$client.prepare( 'SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' AND name <> \'schema_migrations\' ORDER BY name' ).all() as { name: string }[]

    expect( tables.map( ( table ) => getTableConfig( table ).name ).sort() ).toEqual( rows.map( ( row ) => row.name ) )
    expect( rows ).toHaveLength( 12 )
  } )

  for( const table of tables ) {
    const { name } = getTableConfig( table )

    it( `${ name } matches PRAGMA table_info: names, order, type, primary key, default`, () => {
      expect( declared( table ).map( ( { name: column, type, pk, hasDefault } ) => ( { column, type, pk, hasDefault } ) ) )
        .toEqual( actual( name ).map( ( { name: column, type, pk, hasDefault } ) => ( { column, type, pk, hasDefault } ) ) )
    } )

    // SQLite reports notnull = 0 for primary key columns, so only the others are compared
    it( `${ name } matches PRAGMA table_info: NOT NULL on non-key columns`, () => {
      const pick = ( columns: ColumnInfo[] ): [ string, boolean ][] => columns.filter( ( column ) => !column.pk ).map( ( column ) => [ column.name, column.notnull ] )

      expect( pick( declared( table ) ) ).toEqual( pick( actual( name ) ) )
    } )
  }
} )
