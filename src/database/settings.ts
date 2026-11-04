/** Settings key/value database layer. */
import type { Database as DatabaseType } from 'better-sqlite3'

export function get(db: DatabaseType, key: string): string | null {
  if (typeof key !== 'string' || !key) throw new Error('A setting key is required.')
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function set(db: DatabaseType, key: string, value: string): void {
  if (typeof key !== 'string' || !key) throw new Error('A setting key is required.')
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value))
}

export function getAll(db: DatabaseType): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as Array<{
    key: string
    value: string
  }>
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}
