/**
 * Materials database layer.
 *
 * cost_per_unit is DERIVED (purchase_price ÷ purchase_qty, decimal.js) —
 * the schema stores only purchase_qty / purchase_price as TEXT, so it is
 * computed on read. Every price/qty change appends a material_price_events
 * row. Snapshots are never touched here.
 */
import Decimal from 'decimal.js'
import type { Database as DatabaseType } from 'better-sqlite3'
import type {
  ID,
  Material,
  MaterialCategory,
  MaterialPriceEvent,
  NewMaterialInput,
  UnitDimension,
  UpdateMaterialInput,
} from '../shared/types.js'
import { nowIso, requireDecimalText, requireId, requireNonEmpty } from './util.js'

interface MaterialRow {
  id: number
  name: string
  description: string
  category: string
  unit: string
  unit_dimension: string
  purchase_qty: string
  purchase_price: string
  supplier: string
  tax_note: string
  notes: string
  archived: number
  created_at: string
  updated_at: string
}

/** cost_per_unit = purchase_price ÷ purchase_qty. Throws naming the field on bad input. */
export function costPerUnitOf(purchasePrice: string, purchaseQty: string): string {
  const qtyText = requireDecimalText(purchaseQty, 'purchase quantity')
  const qty = new Decimal(qtyText)
  if (qty.lte(0)) {
    throw new Error('purchase quantity must be greater than zero (division by zero).')
  }
  const priceText = requireDecimalText(purchasePrice, 'purchase price')
  const price = new Decimal(priceText)
  if (price.isNegative()) throw new Error('purchase price cannot be negative.')
  return price.div(qty).toString()
}

export function toMaterial(row: MaterialRow): Material {
  let cpu = '0'
  try {
    cpu = costPerUnitOf(row.purchase_price, row.purchase_qty)
  } catch {
    cpu = '0' // legacy rows with bad data degrade honestly, never crash a list
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as MaterialCategory,
    unit: row.unit,
    unit_dimension: row.unit_dimension as UnitDimension,
    purchase_qty: row.purchase_qty,
    purchase_price: row.purchase_price,
    cost_per_unit: cpu,
    supplier: row.supplier,
    tax_note: row.tax_note,
    notes: row.notes,
    archived: row.archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function get(db: DatabaseType, id: ID): Material {
  const rowId = requireId(id, 'material')
  const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(rowId) as
    | MaterialRow
    | undefined
  if (!row) throw new Error(`Material #${rowId} not found.`)
  return toMaterial(row)
}

export function list(db: DatabaseType, includeArchived = false): Material[] {
  const rows = db
    .prepare('SELECT * FROM materials WHERE (? OR archived = 0) ORDER BY name COLLATE NOCASE')
    .all(includeArchived ? 1 : 0) as MaterialRow[]
  return rows.map(toMaterial)
}

export function findByName(db: DatabaseType, name: string): Material | null {
  const row = db
    .prepare('SELECT * FROM materials WHERE name = ? COLLATE NOCASE LIMIT 1')
    .get(name) as MaterialRow | undefined
  return row ? toMaterial(row) : null
}

function recordPriceEvent(
  db: DatabaseType,
  materialId: number,
  purchasePrice: string,
  purchaseQty: string,
  note: string,
): void {
  db.prepare(
    `INSERT INTO material_price_events (material_id, purchase_price, purchase_qty, effective_at, note)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(materialId, purchasePrice, purchaseQty, nowIso(), note)
}

export function create(db: DatabaseType, input: NewMaterialInput): Material {
  const name = requireNonEmpty(input?.name, 'Material name')
  const unit = requireNonEmpty(input?.unit, 'Material unit')
  const purchaseQty = requireDecimalText(input?.purchase_qty, 'purchase quantity')
  const purchasePrice = requireDecimalText(input?.purchase_price, 'purchase price')
  costPerUnitOf(purchasePrice, purchaseQty) // validates qty > 0
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO materials
         (name, description, category, unit, unit_dimension, purchase_qty, purchase_price,
          supplier, tax_note, notes, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      name,
      input.description ?? '',
      input.category ?? 'material',
      unit,
      input.unit_dimension ?? 'count',
      purchaseQty,
      purchasePrice,
      input.supplier ?? '',
      input.tax_note ?? '',
      input.notes ?? '',
      now,
      now,
    )
  const id = info.lastInsertRowid as number
  recordPriceEvent(db, id, purchasePrice, purchaseQty, 'Initial price')
  return get(db, id)
}

export function update(db: DatabaseType, input: UpdateMaterialInput): Material {
  const id = requireId(input?.id, 'material')
  const existing = get(db, id)
  const patch = input as unknown as Record<string, unknown>
  const allowed: Array<[string, string]> = [
    ['name', 'name'],
    ['description', 'description'],
    ['category', 'category'],
    ['unit', 'unit'],
    ['unit_dimension', 'unit_dimension'],
    ['purchase_qty', 'purchase_qty'],
    ['purchase_price', 'purchase_price'],
    ['supplier', 'supplier'],
    ['tax_note', 'tax_note'],
    ['notes', 'notes'],
  ]
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, col] of allowed) {
    if (patch[key] !== undefined) {
      const v = patch[key]
      if (key === 'name') requireNonEmpty(v, 'Material name')
      if (key === 'unit') requireNonEmpty(v, 'Material unit')
      if (key === 'purchase_qty') requireDecimalText(v, 'purchase quantity')
      if (key === 'purchase_price') requireDecimalText(v, 'purchase price')
      sets.push(`${col} = ?`)
      values.push(typeof v === 'string' ? v.trim() : v)
    }
  }
  const newQty =
    patch['purchase_qty'] !== undefined
      ? String(patch['purchase_qty']).trim()
      : existing.purchase_qty
  const newPrice =
    patch['purchase_price'] !== undefined
      ? String(patch['purchase_price']).trim()
      : existing.purchase_price
  costPerUnitOf(newPrice, newQty) // qty 0 → error before any write
  const priceChanged = newQty !== existing.purchase_qty || newPrice !== existing.purchase_price

  const tx = db.transaction(() => {
    if (sets.length > 0) {
      sets.push('updated_at = ?')
      values.push(nowIso())
      values.push(id)
      db.prepare(`UPDATE materials SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    }
    if (priceChanged) {
      recordPriceEvent(db, id, newPrice, newQty, 'Price/qty updated')
    }
  })
  tx()
  return get(db, id)
}

export function archive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'material')
  get(db, rowId)
  db.prepare('UPDATE materials SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

export function unarchive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'material')
  get(db, rowId)
  db.prepare('UPDATE materials SET archived = 0, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

/** Delete is refused with a product-naming message when the material is in use. */
export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'material')
  const material = get(db, rowId)
  const users = db
    .prepare(
      `SELECT p.name FROM product_materials pm
       JOIN products p ON p.id = pm.product_id
       WHERE pm.material_id = ? ORDER BY p.name LIMIT 5`,
    )
    .all(rowId) as Array<{ name: string }>
  if (users.length > 0) {
    const names = users.map((u) => `"${u.name}"`).join(', ')
    throw new Error(
      `Cannot delete material "${material.name}" — it is used by product ${names}. Remove those lines first.`,
    )
  }
  db.prepare('DELETE FROM materials WHERE id = ?').run(rowId)
}

export function priceEvents(db: DatabaseType, materialId: ID): MaterialPriceEvent[] {
  const rowId = requireId(materialId, 'material')
  get(db, rowId)
  return db
    .prepare(
      `SELECT id, material_id, purchase_price, purchase_qty, effective_at, note
       FROM material_price_events WHERE material_id = ?
       ORDER BY effective_at DESC, id DESC`,
    )
    .all(rowId) as MaterialPriceEvent[]
}
