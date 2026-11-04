/** Cost snapshots database layer (append-only history). */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { CostSnapshot, ID } from '../shared/types.js'
import type { NewSnapshotInput } from '../shared/ipc.js'
import { nowIso, requireId, requireNonEmpty } from './util.js'
import { get as getProduct } from './products.js'

export function get(db: DatabaseType, id: ID): CostSnapshot {
  const rowId = requireId(id, 'snapshot')
  const row = db.prepare('SELECT * FROM cost_snapshots WHERE id = ?').get(rowId) as
    | CostSnapshot
    | undefined
  if (!row) throw new Error(`Snapshot #${rowId} not found.`)
  return row
}

export function list(db: DatabaseType, productId?: ID): CostSnapshot[] {
  if (productId === undefined || productId === null) {
    return db
      .prepare('SELECT * FROM cost_snapshots ORDER BY created_at DESC, id DESC')
      .all() as CostSnapshot[]
  }
  const pid = requireId(productId, 'product')
  getProduct(db, pid)
  return db
    .prepare('SELECT * FROM cost_snapshots WHERE product_id = ? ORDER BY created_at DESC, id DESC')
    .all(pid) as CostSnapshot[]
}

export function create(db: DatabaseType, input: NewSnapshotInput): CostSnapshot {
  const snapshotJson = requireNonEmpty(input?.snapshot_json, 'snapshot JSON')
  const productId = input?.product_id ?? null
  if (productId !== null) getProduct(db, requireId(productId, 'product'))
  const info = db
    .prepare(
      `INSERT INTO cost_snapshots (kind, product_id, label, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.kind ?? 'product', productId, input.label ?? '', snapshotJson, nowIso())
  return get(db, info.lastInsertRowid as number)
}
