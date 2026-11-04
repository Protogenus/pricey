/** Labor roles database layer: standard CRUD + archive. Lines SET NULL on delete. */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { ID, LaborRole } from '../shared/types.js'
import { nowIso, requireDecimalText, requireId, requireNonEmpty } from './util.js'
import type { NewLaborRoleInput, UpdateLaborRoleInput } from '../shared/ipc.js'

interface LaborRoleRow {
  id: number
  name: string
  rate_per_hour: string
  notes: string
  archived: number
  created_at: string
  updated_at: string
}

function toRole(row: LaborRoleRow): LaborRole {
  return { ...row }
}

export function get(db: DatabaseType, id: ID): LaborRole {
  const rowId = requireId(id, 'labor role')
  const row = db.prepare('SELECT * FROM labor_roles WHERE id = ?').get(rowId) as
    | LaborRoleRow
    | undefined
  if (!row) throw new Error(`Labor role #${rowId} not found.`)
  return toRole(row)
}

export function list(db: DatabaseType, includeArchived = false): LaborRole[] {
  const rows = db
    .prepare('SELECT * FROM labor_roles WHERE (? OR archived = 0) ORDER BY name COLLATE NOCASE')
    .all(includeArchived ? 1 : 0) as LaborRoleRow[]
  return rows.map(toRole)
}

export function findByName(db: DatabaseType, name: string): LaborRole | null {
  const row = db
    .prepare('SELECT * FROM labor_roles WHERE name = ? COLLATE NOCASE LIMIT 1')
    .get(name) as LaborRoleRow | undefined
  return row ? toRole(row) : null
}

export function create(db: DatabaseType, input: NewLaborRoleInput): LaborRole {
  const name = requireNonEmpty(input?.name, 'Labor role name')
  const rate = input?.rate_per_hour ?? '0'
  requireDecimalText(rate, 'rate per hour')
  if (Number(rate) < 0) throw new Error('rate per hour cannot be negative.')
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO labor_roles (name, rate_per_hour, notes, archived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(name, String(rate).trim(), input.notes ?? '', now, now)
  return get(db, info.lastInsertRowid as number)
}

export function update(db: DatabaseType, input: UpdateLaborRoleInput): LaborRole {
  const id = requireId(input?.id, 'labor role')
  get(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Labor role name'))
  }
  if (patch['rate_per_hour'] !== undefined) {
    const r = requireDecimalText(patch['rate_per_hour'], 'rate per hour')
    if (Number(r) < 0) throw new Error('rate per hour cannot be negative.')
    sets.push('rate_per_hour = ?')
    values.push(r)
  }
  if (patch['notes'] !== undefined) {
    sets.push('notes = ?')
    values.push(String(patch['notes'] ?? ''))
  }
  if (sets.length === 0) return get(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE labor_roles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return get(db, id)
}

export function archive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'labor role')
  get(db, rowId)
  db.prepare('UPDATE labor_roles SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

export function unarchive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'labor role')
  get(db, rowId)
  db.prepare('UPDATE labor_roles SET archived = 0, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'labor role')
  get(db, rowId)
  // product_labor.role_id is ON DELETE SET NULL — product lines keep their
  // own rate/task text and survive a role deletion.
  db.prepare('DELETE FROM labor_roles WHERE id = ?').run(rowId)
}
