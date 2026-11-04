import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'

/** Open (or create) the application database and enable integrity pragmas. */
export function openDatabase(filePath: string): DatabaseType {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export type { DatabaseType }
