/** Scenarios database layer: CRUD + duplicate. Compute lives in main/ipc.ts. */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { ID, ScenarioRec } from '../shared/types.js'
import type { NewScenarioInput, UpdateScenarioInput } from '../shared/ipc.js'
import { nowIso, requireId, requireNonEmpty } from './util.js'
import { get as getProduct } from './products.js'

export function get(db: DatabaseType, id: ID): ScenarioRec {
  const rowId = requireId(id, 'scenario')
  const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(rowId) as
    | ScenarioRec
    | undefined
  if (!row) throw new Error(`Scenario #${rowId} not found.`)
  return row
}

export function list(db: DatabaseType, productId: ID): ScenarioRec[] {
  const pid = requireId(productId, 'product')
  getProduct(db, pid)
  return db
    .prepare('SELECT * FROM scenarios WHERE product_id = ? ORDER BY updated_at DESC')
    .all(pid) as ScenarioRec[]
}

export function create(db: DatabaseType, input: NewScenarioInput): ScenarioRec {
  const productId = requireId(input?.product_id, 'product')
  getProduct(db, productId)
  const name = requireNonEmpty(input?.name, 'Scenario name')
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO scenarios
         (product_id, name, base_snapshot_json, overrides_json, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      productId,
      name,
      input.base_snapshot_json ?? '{}',
      input.overrides_json ?? '{}',
      input.notes ?? '',
      now,
      now,
    )
  return get(db, info.lastInsertRowid as number)
}

export function update(db: DatabaseType, input: UpdateScenarioInput): ScenarioRec {
  const id = requireId(input?.id, 'scenario')
  get(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Scenario name'))
  }
  if (patch['base_snapshot_json'] !== undefined) {
    sets.push('base_snapshot_json = ?')
    values.push(String(patch['base_snapshot_json'] ?? '{}'))
  }
  if (patch['overrides_json'] !== undefined) {
    sets.push('overrides_json = ?')
    values.push(String(patch['overrides_json'] ?? '{}'))
  }
  if (patch['notes'] !== undefined) {
    sets.push('notes = ?')
    values.push(String(patch['notes'] ?? ''))
  }
  if (patch['product_id'] !== undefined) {
    const pid = requireId(patch['product_id'], 'product')
    getProduct(db, pid)
    sets.push('product_id = ?')
    values.push(pid)
  }
  if (sets.length === 0) return get(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE scenarios SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return get(db, id)
}

export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'scenario')
  get(db, rowId)
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(rowId)
}

export function duplicate(db: DatabaseType, id: ID): ScenarioRec {
  const src = get(db, id)
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO scenarios
         (product_id, name, base_snapshot_json, overrides_json, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      src.product_id,
      `${src.name} (copy)`,
      src.base_snapshot_json,
      src.overrides_json,
      src.notes,
      now,
      now,
    )
  return get(db, info.lastInsertRowid as number)
}
