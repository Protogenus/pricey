import type { Database as DatabaseType } from 'better-sqlite3'

export interface Migration {
  /** Unique, ordered identifier, e.g. '001_initial'. */
  id: string
  description: string
  up: (db: DatabaseType) => void
}

/**
 * Run pending migrations in order. Each migration runs inside its own
 * transaction together with its version-row insert: a failing migration
 * rolls back cleanly and aborts startup (fail-safe, data preserved).
 */
export function runMigrations(db: DatabaseType, migrations: Migration[]): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  )
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]
  const applied = new Set(rows.map((r) => r.version))
  const pending = migrations
    .filter((m) => !applied.has(m.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const markApplied = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  )
  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db)
      markApplied.run(m.id, new Date().toISOString())
    })
    tx()
  }
}

export function appliedVersions(db: DatabaseType): string[] {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: string
  }[]
  return rows.map((r) => r.version)
}
