/** Overhead items database layer: standard CRUD + archive. Lines SET NULL on delete. */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { ID, OverheadItem } from '../shared/types.js'
import { nowIso, requireDecimalText, requireId, requireNonEmpty } from './util.js'
import type { NewOverheadItemInput, UpdateOverheadItemInput } from '../shared/ipc.js'

interface OverheadRow {
  id: number
  name: string
  amount: string
  period: string
  notes: string
  archived: number
  created_at: string
  updated_at: string
}

function toItem(row: OverheadRow): OverheadItem {
  return { ...row }
}

export function get(db: DatabaseType, id: ID): OverheadItem {
  const rowId = requireId(id, 'overhead item')
  const row = db.prepare('SELECT * FROM overhead_items WHERE id = ?').get(rowId) as
    | OverheadRow
    | undefined
  if (!row) throw new Error(`Overhead item #${rowId} not found.`)
  return toItem(row)
}

export function list(db: DatabaseType, includeArchived = false): OverheadItem[] {
  const rows = db
    .prepare('SELECT * FROM overhead_items WHERE (? OR archived = 0) ORDER BY name COLLATE NOCASE')
    .all(includeArchived ? 1 : 0) as OverheadRow[]
  return rows.map(toItem)
}

export function findByName(db: DatabaseType, name: string): OverheadItem | null {
  const row = db
    .prepare('SELECT * FROM overhead_items WHERE name = ? COLLATE NOCASE LIMIT 1')
    .get(name) as OverheadRow | undefined
  return row ? toItem(row) : null
}

export function create(db: DatabaseType, input: NewOverheadItemInput): OverheadItem {
  const name = requireNonEmpty(input?.name, 'Overhead item name')
  const amount = requireDecimalText(input?.amount ?? '0', 'amount')
  if (Number(amount) < 0) throw new Error('amount cannot be negative.')
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO overhead_items (name, amount, period, notes, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(name, amount, input.period ?? 'monthly', input.notes ?? '', now, now)
  return get(db, info.lastInsertRowid as number)
}

export function update(db: DatabaseType, input: UpdateOverheadItemInput): OverheadItem {
  const id = requireId(input?.id, 'overhead item')
  get(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Overhead item name'))
  }
  if (patch['amount'] !== undefined) {
    const a = requireDecimalText(patch['amount'], 'amount')
    if (Number(a) < 0) throw new Error('amount cannot be negative.')
    sets.push('amount = ?')
    values.push(a)
  }
  if (patch['period'] !== undefined) {
    sets.push('period = ?')
    values.push(String(patch['period'] ?? 'monthly'))
  }
  if (patch['notes'] !== undefined) {
    sets.push('notes = ?')
    values.push(String(patch['notes'] ?? ''))
  }
  if (sets.length === 0) return get(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE overhead_items SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return get(db, id)
}

export function archive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'overhead item')
  get(db, rowId)
  db.prepare('UPDATE overhead_items SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

export function unarchive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'overhead item')
  get(db, rowId)
  db.prepare('UPDATE overhead_items SET archived = 0, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'overhead item')
  get(db, rowId)
  // product_overhead.overhead_item_id is ON DELETE SET NULL — product lines
  // keep their own method/value and survive an item deletion.
  db.prepare('DELETE FROM overhead_items WHERE id = ?').run(rowId)
}
