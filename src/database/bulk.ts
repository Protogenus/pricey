/** Bulk rules + tiers database layer. Compute lives in main/ipc.ts. */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { BulkRule, BulkTier, ID } from '../shared/types.js'
import type {
  NewBulkRuleInput,
  NewBulkTierInput,
  UpdateBulkRuleInput,
  UpdateBulkTierInput,
} from '../shared/ipc.js'
import { nowIso, requireDecimalText, requireFractionText, requireId, requireNonEmpty } from './util.js'
import { get as getProduct } from './products.js'

/* ---------------- rules ---------------- */

export function getRule(db: DatabaseType, id: ID): BulkRule {
  const rowId = requireId(id, 'bulk rule')
  const row = db.prepare('SELECT * FROM bulk_rules WHERE id = ?').get(rowId) as
    | BulkRule
    | undefined
  if (!row) throw new Error(`Bulk rule #${rowId} not found.`)
  return row
}

export function listRules(db: DatabaseType, productId: ID): BulkRule[] {
  const pid = requireId(productId, 'product')
  getProduct(db, pid)
  return db
    .prepare('SELECT * FROM bulk_rules WHERE product_id = ? ORDER BY name COLLATE NOCASE')
    .all(pid) as BulkRule[]
}

export function createRule(db: DatabaseType, input: NewBulkRuleInput): BulkRule {
  const productId = requireId(input?.product_id, 'product')
  getProduct(db, productId)
  const name = requireNonEmpty(input?.name, 'Bulk rule name')
  const now = nowIso()
  const info = db
    .prepare(
      'INSERT INTO bulk_rules (product_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(productId, name, now, now)
  return getRule(db, info.lastInsertRowid as number)
}

export function updateRule(db: DatabaseType, input: UpdateBulkRuleInput): BulkRule {
  const id = requireId(input?.id, 'bulk rule')
  getRule(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Bulk rule name'))
  }
  if (patch['product_id'] !== undefined) {
    const pid = requireId(patch['product_id'], 'product')
    getProduct(db, pid)
    sets.push('product_id = ?')
    values.push(pid)
  }
  if (sets.length === 0) return getRule(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE bulk_rules SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getRule(db, id)
}

export function deleteRule(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'bulk rule')
  getRule(db, rowId)
  // bulk_tiers.bulk_rule_id is ON DELETE CASCADE.
  db.prepare('DELETE FROM bulk_rules WHERE id = ?').run(rowId)
}

/* ---------------- tiers ---------------- */

export function getTier(db: DatabaseType, id: ID): BulkTier {
  const rowId = requireId(id, 'bulk tier')
  const row = db.prepare('SELECT * FROM bulk_tiers WHERE id = ?').get(rowId) as
    | BulkTier
    | undefined
  if (!row) throw new Error(`Bulk tier #${rowId} not found.`)
  return row
}

export function listTiers(db: DatabaseType, ruleId: ID): BulkTier[] {
  const rid = requireId(ruleId, 'bulk rule')
  getRule(db, rid)
  return db
    .prepare('SELECT * FROM bulk_tiers WHERE bulk_rule_id = ? ORDER BY min_qty, sort_order, id')
    .all(rid) as BulkTier[]
}

export function createTier(db: DatabaseType, input: NewBulkTierInput): BulkTier {
  const ruleId = requireId(input?.bulk_rule_id, 'bulk rule')
  getRule(db, ruleId)
  const minQty = input?.min_qty ?? 1
  if (typeof minQty !== 'number' || !Number.isInteger(minQty) || minQty < 1) {
    throw new Error('tier minimum quantity must be a whole number of at least 1.')
  }
  const info = db
    .prepare(
      `INSERT INTO bulk_tiers
         (bulk_rule_id, min_qty, material_discount_pct, labor_efficiency_pct,
          fixed_setup, batch_waste_pct, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ruleId,
      minQty,
      requireFractionText(input?.material_discount_pct ?? '0', 'material discount percentage'),
      requireFractionText(input?.labor_efficiency_pct ?? '0', 'labor efficiency percentage'),
      requireDecimalText(input?.fixed_setup ?? '0', 'fixed setup cost'),
      requireFractionText(input?.batch_waste_pct ?? '0', 'batch waste percentage'),
      input.sort_order ?? 0,
    )
  return getTier(db, info.lastInsertRowid as number)
}

export function updateTier(db: DatabaseType, input: UpdateBulkTierInput): BulkTier {
  const id = requireId(input?.id, 'bulk tier')
  getTier(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['min_qty'] !== undefined) {
    const mq = patch['min_qty']
    if (typeof mq !== 'number' || !Number.isInteger(mq) || mq < 1) {
      throw new Error('tier minimum quantity must be a whole number of at least 1.')
    }
    sets.push('min_qty = ?')
    values.push(mq)
  }
  if (patch['material_discount_pct'] !== undefined) {
    sets.push('material_discount_pct = ?')
    values.push(requireFractionText(patch['material_discount_pct'], 'material discount percentage'))
  }
  if (patch['labor_efficiency_pct'] !== undefined) {
    sets.push('labor_efficiency_pct = ?')
    values.push(requireFractionText(patch['labor_efficiency_pct'], 'labor efficiency percentage'))
  }
  if (patch['fixed_setup'] !== undefined) {
    const fs = requireDecimalText(patch['fixed_setup'], 'fixed setup cost')
    if (Number(fs) < 0) throw new Error('fixed setup cost cannot be negative.')
    sets.push('fixed_setup = ?')
    values.push(fs)
  }
  if (patch['batch_waste_pct'] !== undefined) {
    sets.push('batch_waste_pct = ?')
    values.push(requireFractionText(patch['batch_waste_pct'], 'batch waste percentage'))
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length === 0) return getTier(db, id)
  values.push(id)
  db.prepare(`UPDATE bulk_tiers SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getTier(db, id)
}

export function deleteTier(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'bulk tier')
  getTier(db, rowId)
  db.prepare('DELETE FROM bulk_tiers WHERE id = ?').run(rowId)
}
