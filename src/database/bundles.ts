/** Bundles + bundle items database layer. Compute lives in main/ipc.ts. */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { Bundle, BundleItem, DiscountType, ID } from '../shared/types.js'
import type {
  NewBundleInput,
  NewBundleItemInput,
  UpdateBundleInput,
  UpdateBundleItemInput,
} from '../shared/ipc.js'
import { nowIso, requireDecimalText, requireId, requireNonEmpty } from './util.js'
import { get as getProduct } from './products.js'

const DISCOUNT_TYPES: DiscountType[] = ['none', 'pct', 'fixed']

export function get(db: DatabaseType, id: ID): Bundle {
  const rowId = requireId(id, 'bundle')
  const row = db.prepare('SELECT * FROM bundles WHERE id = ?').get(rowId) as
    | Bundle
    | undefined
  if (!row) throw new Error(`Bundle #${rowId} not found.`)
  return row
}

export function list(db: DatabaseType): Bundle[] {
  return db.prepare('SELECT * FROM bundles ORDER BY name COLLATE NOCASE').all() as Bundle[]
}

export function create(db: DatabaseType, input: NewBundleInput): Bundle {
  const name = requireNonEmpty(input?.name, 'Bundle name')
  const discountType = (input?.discount_type ?? 'none') as DiscountType
  if (!DISCOUNT_TYPES.includes(discountType)) {
    throw new Error(`Unknown discount type "${input?.discount_type}".`)
  }
  const discountValue = requireDecimalText(input?.discount_value ?? '0', 'discount value')
  if (Number(discountValue) < 0) throw new Error('discount value cannot be negative.')
  if (discountType === 'pct' && Number(discountValue) >= 1) {
    throw new Error('discount value for a percentage discount must be below 1 (a fraction).')
  }
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO bundles (name, description, discount_type, discount_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(name, input.description ?? '', discountType, discountValue, now, now)
  return get(db, info.lastInsertRowid as number)
}

export function update(db: DatabaseType, input: UpdateBundleInput): Bundle {
  const id = requireId(input?.id, 'bundle')
  get(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Bundle name'))
  }
  if (patch['description'] !== undefined) {
    sets.push('description = ?')
    values.push(String(patch['description'] ?? ''))
  }
  if (patch['discount_type'] !== undefined) {
    const dt = patch['discount_type'] as DiscountType
    if (!DISCOUNT_TYPES.includes(dt)) throw new Error(`Unknown discount type "${patch['discount_type']}".`)
    sets.push('discount_type = ?')
    values.push(dt)
  }
  if (patch['discount_value'] !== undefined) {
    const dv = requireDecimalText(patch['discount_value'], 'discount value')
    if (Number(dv) < 0) throw new Error('discount value cannot be negative.')
    sets.push('discount_value = ?')
    values.push(dv)
  }
  if (sets.length === 0) return get(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE bundles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return get(db, id)
}

export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'bundle')
  get(db, rowId)
  // bundle_items.bundle_id is ON DELETE CASCADE.
  db.prepare('DELETE FROM bundles WHERE id = ?').run(rowId)
}

/* ---------------- bundle items ---------------- */

export function getItem(db: DatabaseType, id: ID): BundleItem {
  const rowId = requireId(id, 'bundle item')
  const row = db
    .prepare(
      `SELECT bi.id, bi.bundle_id, bi.product_id, p.name AS product_name,
              bi.quantity, bi.sort_order
       FROM bundle_items bi JOIN products p ON p.id = bi.product_id
       WHERE bi.id = ?`,
    )
    .get(rowId) as BundleItem | undefined
  if (!row) throw new Error(`Bundle item #${rowId} not found.`)
  return row
}

export function listItems(db: DatabaseType, bundleId: ID): BundleItem[] {
  const bid = requireId(bundleId, 'bundle')
  get(db, bid)
  return db
    .prepare(
      `SELECT bi.id, bi.bundle_id, bi.product_id, p.name AS product_name,
              bi.quantity, bi.sort_order
       FROM bundle_items bi JOIN products p ON p.id = bi.product_id
       WHERE bi.bundle_id = ? ORDER BY bi.sort_order, bi.id`,
    )
    .all(bid) as BundleItem[]
}

export function addItem(
  db: DatabaseType,
  bundleId: ID,
  input: NewBundleItemInput,
): BundleItem {
  const bid = requireId(bundleId, 'bundle')
  get(db, bid)
  const productId = requireId(input?.product_id, 'product')
  getProduct(db, productId)
  const quantity = requireDecimalText(input?.quantity ?? '1', 'item quantity')
  if (Number(quantity) <= 0) throw new Error('item quantity must be greater than zero.')
  const info = db
    .prepare(
      `INSERT INTO bundle_items (bundle_id, product_id, quantity, sort_order)
       VALUES (?, ?, ?, ?)`,
    )
    .run(bid, productId, quantity, input.sort_order ?? 0)
  return getItem(db, info.lastInsertRowid as number)
}

export function updateItem(db: DatabaseType, input: UpdateBundleItemInput): BundleItem {
  const id = requireId(input?.id, 'bundle item')
  getItem(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['product_id'] !== undefined) {
    const pid = requireId(patch['product_id'], 'product')
    getProduct(db, pid)
    sets.push('product_id = ?')
    values.push(pid)
  }
  if (patch['quantity'] !== undefined) {
    const q = requireDecimalText(patch['quantity'], 'item quantity')
    if (Number(q) <= 0) throw new Error('item quantity must be greater than zero.')
    sets.push('quantity = ?')
    values.push(q)
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length > 0) {
    values.push(id)
    db.prepare(`UPDATE bundle_items SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  return getItem(db, id)
}

export function removeItem(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'bundle item')
  getItem(db, rowId)
  db.prepare('DELETE FROM bundle_items WHERE id = ?').run(rowId)
}
