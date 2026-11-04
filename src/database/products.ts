/**
 * Products database layer: CRUD, archive, the five cost-component line
 * tables, getFull, and buildCostInput — the bridge from stored product data
 * to the engine's ProductCostInput.
 *
 * buildCostInput resolves components RECURSIVELY through the DB, threading
 * an ancestor id set so the engine's own cycle check sees the full chain.
 * Custom units come from the `pricey.customUnits` setting (JSON array).
 */
import type { Database as DatabaseType } from 'better-sqlite3'
import type {
  ID,
  LaborMode,
  NewProductInput,
  OverheadMethod,
  Product,
  ProductComponentLine,
  ProductFull,
  ProductLaborLine,
  ProductMaterialLine,
  ProductOtherCostLine,
  ProductOverheadLine,
  UnitDimension,
} from '../shared/types.js'
import type {
  NewProductComponentLineInput,
  NewProductLaborLineInput,
  NewProductMaterialLineInput,
  NewProductOtherCostLineInput,
  NewProductOverheadLineInput,
  UpdateProductComponentLineInput,
  UpdateProductInput,
  UpdateProductLaborLineInput,
  UpdateProductMaterialLineInput,
  UpdateProductOtherCostLineInput,
  UpdateProductOverheadLineInput,
} from '../shared/ipc.js'
import type { CustomUnitDef, ProductCostInput } from '../engine/index.js'
import { costPerUnitOf, get as getMaterial } from './materials.js'
import { get as getLaborRole } from './labor.js'
import { get as getOverheadItem } from './overhead.js'
import { get as getSetting } from './settings.js'
import { isValidImageRef } from './images.js'
import { nowIso, parseJson, requireDecimalText, requireFractionText, requireId, requireNonEmpty } from './util.js'

interface ProductRow {
  id: number
  name: string
  sku: string
  description: string
  category: string
  image_path: string
  unit_of_sale: string
  batch_size: number
  is_component: number
  waste_pct: string
  defect_pct: string
  notes: string
  archived: number
  created_at: string
  updated_at: string
}

function toProduct(row: ProductRow): Product {
  return { ...row }
}

export function get(db: DatabaseType, id: ID): Product {
  const rowId = requireId(id, 'product')
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(rowId) as
    | ProductRow
    | undefined
  if (!row) throw new Error(`Product #${rowId} not found.`)
  return toProduct(row)
}

export function list(db: DatabaseType, includeArchived = false): Product[] {
  const rows = db
    .prepare('SELECT * FROM products WHERE (? OR archived = 0) ORDER BY name COLLATE NOCASE')
    .all(includeArchived ? 1 : 0) as ProductRow[]
  return rows.map(toProduct)
}

function validateBatchSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error('batch size must be a whole number of at least 1.')
  }
  return v
}

export function create(db: DatabaseType, input: NewProductInput): Product {
  const name = requireNonEmpty(input?.name, 'Product name')
  const batchSize = input?.batch_size === undefined ? 1 : validateBatchSize(input.batch_size)
  if (input?.waste_pct !== undefined) requireFractionText(input.waste_pct, 'waste percentage')
  if (input?.defect_pct !== undefined) requireFractionText(input.defect_pct, 'defect percentage')
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO products
         (name, sku, description, category, image_path, unit_of_sale, batch_size,
          is_component, waste_pct, defect_pct, notes, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      name,
      input.sku ?? '',
      input.description ?? '',
      input.category ?? '',
      '',
      input.unit_of_sale ?? 'piece',
      batchSize,
      input.is_component ? 1 : 0,
      input.waste_pct ?? '0',
      input.defect_pct ?? '0',
      input.notes ?? '',
      now,
      now,
    )
  return get(db, info.lastInsertRowid as number)
}

export function update(db: DatabaseType, input: UpdateProductInput): Product {
  const id = requireId(input?.id, 'product')
  get(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  const textCols: Array<[string, string, ((v: unknown) => string) | null]> = [
    ['name', 'name', (v) => requireNonEmpty(v, 'Product name')],
    ['sku', 'sku', null],
    ['description', 'description', null],
    ['category', 'category', null],
    ['unit_of_sale', 'unit_of_sale', null],
    ['image_path', 'image_path', null],
    ['notes', 'notes', null],
  ]
  for (const [key, col, validate] of textCols) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`)
      values.push(validate ? validate(patch[key]) : String(patch[key] ?? ''))
    }
  }
  if (patch['batch_size'] !== undefined) {
    sets.push('batch_size = ?')
    values.push(validateBatchSize(patch['batch_size']))
  }
  if (patch['is_component'] !== undefined) {
    sets.push('is_component = ?')
    values.push(patch['is_component'] ? 1 : 0)
  }
  if (patch['waste_pct'] !== undefined) {
    sets.push('waste_pct = ?')
    values.push(requireFractionText(patch['waste_pct'], 'waste percentage'))
  }
  if (patch['defect_pct'] !== undefined) {
    sets.push('defect_pct = ?')
    values.push(requireFractionText(patch['defect_pct'], 'defect percentage'))
  }
  if (sets.length === 0) return get(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return get(db, id)
}

export function archive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'product')
  get(db, rowId)
  db.prepare('UPDATE products SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

export function unarchive(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'product')
  get(db, rowId)
  db.prepare('UPDATE products SET archived = 0, updated_at = ? WHERE id = ?').run(nowIso(), rowId)
}

/**
 * Link (or unlink, with '') a product's image. The reference is validated
 * against the content-addressed format (`images/<sha256>.<ext>`); the file
 * itself is managed by src/database/images.ts. Deleting the orphaned file
 * after replace/remove is the caller's job (see releaseUnreferenced).
 */
export function setImage(db: DatabaseType, id: ID, imageRef: string): Product {
  const rowId = requireId(id, 'product')
  get(db, rowId)
  if (imageRef !== '' && !isValidImageRef(imageRef)) {
    throw new Error(`Invalid image reference "${imageRef}".`)
  }
  db.prepare('UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?').run(
    imageRef,
    nowIso(),
    rowId,
  )
  return get(db, rowId)
}

/** Delete; RESTRICT references surface a clear message naming the product(s). */
export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'product')
  const product = get(db, rowId)
  const usedAsComponent = db
    .prepare(
      `SELECT p.name FROM product_components pc
       JOIN products p ON p.id = pc.product_id
       WHERE pc.component_id = ? ORDER BY p.name LIMIT 5`,
    )
    .all(rowId) as Array<{ name: string }>
  if (usedAsComponent.length > 0) {
    throw new Error(
      `Cannot delete product "${product.name}" — it is a component of ${usedAsComponent
        .map((u) => `"${u.name}"`)
        .join(', ')}. Remove those component lines first.`,
    )
  }
  const usedInBundle = db
    .prepare(
      `SELECT b.name FROM bundle_items bi
       JOIN bundles b ON b.id = bi.bundle_id
       WHERE bi.product_id = ? ORDER BY b.name LIMIT 5`,
    )
    .all(rowId) as Array<{ name: string }>
  if (usedInBundle.length > 0) {
    throw new Error(
      `Cannot delete product "${product.name}" — it is in bundle ${usedInBundle
        .map((u) => `"${u.name}"`)
        .join(', ')}. Remove those bundle items first.`,
    )
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(rowId)
}

/* ------------------------------------------------------------------ */
/* getFull                                                            */
/* ------------------------------------------------------------------ */

export function getFull(db: DatabaseType, id: ID): ProductFull {
  const product = get(db, id)
  const materials = db
    .prepare(
      `SELECT pm.id, pm.product_id, pm.material_id, m.name AS material_name,
              pm.quantity, pm.unit, pm.waste_pct, pm.sort_order
       FROM product_materials pm JOIN materials m ON m.id = pm.material_id
       WHERE pm.product_id = ? ORDER BY pm.sort_order, pm.id`,
    )
    .all(id) as ProductMaterialLine[]
  const labor = db
    .prepare(
      `SELECT pl.id, pl.product_id, pl.role_id, r.name AS role_name,
              pl.task_name, pl.mode, pl.rate, pl.quantity, pl.sort_order
       FROM product_labor pl LEFT JOIN labor_roles r ON r.id = pl.role_id
       WHERE pl.product_id = ? ORDER BY pl.sort_order, pl.id`,
    )
    .all(id) as ProductLaborLine[]
  const overhead = db
    .prepare(
      `SELECT po.id, po.product_id, po.overhead_item_id, oi.name AS item_name,
              po.method, po.value, po.sort_order
       FROM product_overhead po LEFT JOIN overhead_items oi ON oi.id = po.overhead_item_id
       WHERE po.product_id = ? ORDER BY po.sort_order, po.id`,
    )
    .all(id) as ProductOverheadLine[]
  const components = db
    .prepare(
      `SELECT pc.id, pc.product_id, pc.component_id, p.name AS component_name,
              pc.quantity, pc.sort_order
       FROM product_components pc JOIN products p ON p.id = pc.component_id
       WHERE pc.product_id = ? ORDER BY pc.sort_order, pc.id`,
    )
    .all(id) as ProductComponentLine[]
  const other_costs = db
    .prepare(
      `SELECT id, product_id, name, amount_per_unit, sort_order
       FROM product_other_costs WHERE product_id = ? ORDER BY sort_order, id`,
    )
    .all(id) as ProductOtherCostLine[]
  return { ...product, materials, labor, overhead, components, other_costs }
}

/* ------------------------------------------------------------------ */
/* Line CRUD                                                          */
/* ------------------------------------------------------------------ */

const LABOR_MODES: LaborMode[] = ['hourly', 'per_minute', 'per_unit', 'fixed']
const OVERHEAD_METHODS: OverheadMethod[] = [
  'per_unit',
  'per_batch',
  'pct_of_direct',
  'per_hour',
  'monthly_share',
]

export function addMaterialLine(
  db: DatabaseType,
  productId: ID,
  input: NewProductMaterialLineInput,
): ProductMaterialLine {
  const pid = requireId(productId, 'product')
  get(db, pid)
  const materialId = requireId(input?.material_id, 'material')
  getMaterial(db, materialId)
  const quantity = requireDecimalText(input?.quantity, 'material quantity')
  if (Number(quantity) < 0) throw new Error('material quantity cannot be negative.')
  const unit = requireNonEmpty(input?.unit, 'line unit')
  const wastePct = requireFractionText(input?.waste_pct ?? '0', 'line waste percentage')
  const info = db
    .prepare(
      `INSERT INTO product_materials
         (product_id, material_id, quantity, unit, waste_pct, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(pid, materialId, quantity, unit, wastePct, input.sort_order ?? 0)
  return getMaterialLine(db, info.lastInsertRowid as number)
}

function getMaterialLine(db: DatabaseType, lineId: number): ProductMaterialLine {
  const row = db
    .prepare(
      `SELECT pm.id, pm.product_id, pm.material_id, m.name AS material_name,
              pm.quantity, pm.unit, pm.waste_pct, pm.sort_order
       FROM product_materials pm JOIN materials m ON m.id = pm.material_id
       WHERE pm.id = ?`,
    )
    .get(lineId) as ProductMaterialLine | undefined
  if (!row) throw new Error(`Product material line #${lineId} not found.`)
  return row
}

export function updateMaterialLine(
  db: DatabaseType,
  input: UpdateProductMaterialLineInput,
): ProductMaterialLine {
  const id = requireId(input?.id, 'product material line')
  getMaterialLine(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['material_id'] !== undefined) {
    const mid = requireId(patch['material_id'], 'material')
    getMaterial(db, mid)
    sets.push('material_id = ?')
    values.push(mid)
  }
  if (patch['quantity'] !== undefined) {
    const q = requireDecimalText(patch['quantity'], 'material quantity')
    if (Number(q) < 0) throw new Error('material quantity cannot be negative.')
    sets.push('quantity = ?')
    values.push(q)
  }
  if (patch['unit'] !== undefined) {
    sets.push('unit = ?')
    values.push(requireNonEmpty(patch['unit'], 'line unit'))
  }
  if (patch['waste_pct'] !== undefined) {
    sets.push('waste_pct = ?')
    values.push(requireFractionText(patch['waste_pct'], 'line waste percentage'))
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length > 0) {
    values.push(id)
    db.prepare(`UPDATE product_materials SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  return getMaterialLine(db, id)
}

export function removeMaterialLine(db: DatabaseType, lineId: ID): void {
  const id = requireId(lineId, 'product material line')
  getMaterialLine(db, id)
  db.prepare('DELETE FROM product_materials WHERE id = ?').run(id)
}

export function addLaborLine(
  db: DatabaseType,
  productId: ID,
  input: NewProductLaborLineInput,
): ProductLaborLine {
  const pid = requireId(productId, 'product')
  get(db, pid)
  const mode = (input?.mode ?? 'hourly') as LaborMode
  if (!LABOR_MODES.includes(mode)) throw new Error(`Unknown labor mode "${input?.mode}".`)
  const roleId = input?.role_id ?? null
  if (roleId !== null) getLaborRole(db, requireId(roleId, 'labor role'))
  const rate = requireDecimalText(input?.rate ?? '0', 'labor rate')
  if (Number(rate) < 0) throw new Error('labor rate cannot be negative.')
  const quantity = requireDecimalText(input?.quantity ?? '0', 'labor quantity')
  if (Number(quantity) < 0) throw new Error('labor quantity cannot be negative.')
  const info = db
    .prepare(
      `INSERT INTO product_labor
         (product_id, role_id, task_name, mode, rate, quantity, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(pid, roleId, input.task_name ?? '', mode, rate, quantity, input.sort_order ?? 0)
  return getLaborLine(db, info.lastInsertRowid as number)
}

function getLaborLine(db: DatabaseType, lineId: number): ProductLaborLine {
  const row = db
    .prepare(
      `SELECT pl.id, pl.product_id, pl.role_id, r.name AS role_name,
              pl.task_name, pl.mode, pl.rate, pl.quantity, pl.sort_order
       FROM product_labor pl LEFT JOIN labor_roles r ON r.id = pl.role_id
       WHERE pl.id = ?`,
    )
    .get(lineId) as ProductLaborLine | undefined
  if (!row) throw new Error(`Product labor line #${lineId} not found.`)
  return row
}

export function updateLaborLine(
  db: DatabaseType,
  input: UpdateProductLaborLineInput,
): ProductLaborLine {
  const id = requireId(input?.id, 'product labor line')
  getLaborLine(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['role_id'] !== undefined) {
    const rid = patch['role_id']
    const roleId = rid === null ? null : requireId(rid, 'labor role')
    if (roleId !== null) getLaborRole(db, roleId)
    sets.push('role_id = ?')
    values.push(roleId)
  }
  if (patch['task_name'] !== undefined) {
    sets.push('task_name = ?')
    values.push(String(patch['task_name'] ?? ''))
  }
  if (patch['mode'] !== undefined) {
    const mode = patch['mode'] as LaborMode
    if (!LABOR_MODES.includes(mode)) throw new Error(`Unknown labor mode "${patch['mode']}".`)
    sets.push('mode = ?')
    values.push(mode)
  }
  if (patch['rate'] !== undefined) {
    const r = requireDecimalText(patch['rate'], 'labor rate')
    if (Number(r) < 0) throw new Error('labor rate cannot be negative.')
    sets.push('rate = ?')
    values.push(r)
  }
  if (patch['quantity'] !== undefined) {
    const q = requireDecimalText(patch['quantity'], 'labor quantity')
    if (Number(q) < 0) throw new Error('labor quantity cannot be negative.')
    sets.push('quantity = ?')
    values.push(q)
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length > 0) {
    values.push(id)
    db.prepare(`UPDATE product_labor SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  return getLaborLine(db, id)
}

export function removeLaborLine(db: DatabaseType, lineId: ID): void {
  const id = requireId(lineId, 'product labor line')
  getLaborLine(db, id)
  db.prepare('DELETE FROM product_labor WHERE id = ?').run(id)
}

export function addOverheadLine(
  db: DatabaseType,
  productId: ID,
  input: NewProductOverheadLineInput,
): ProductOverheadLine {
  const pid = requireId(productId, 'product')
  get(db, pid)
  const method = (input?.method ?? 'per_unit') as OverheadMethod
  if (!OVERHEAD_METHODS.includes(method)) throw new Error(`Unknown overhead method "${input?.method}".`)
  const itemId = input?.overhead_item_id ?? null
  if (itemId !== null) getOverheadItem(db, requireId(itemId, 'overhead item'))
  const value = requireDecimalText(input?.value ?? '0', 'overhead value')
  if (Number(value) < 0) throw new Error('overhead value cannot be negative.')
  if (method === 'pct_of_direct' && Number(value) >= 1) {
    throw new Error('overhead value for "percentage of direct costs" must be below 1 (a fraction).')
  }
  const info = db
    .prepare(
      `INSERT INTO product_overhead
         (product_id, overhead_item_id, method, value, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(pid, itemId, method, value, input.sort_order ?? 0)
  return getOverheadLine(db, info.lastInsertRowid as number)
}

function getOverheadLine(db: DatabaseType, lineId: number): ProductOverheadLine {
  const row = db
    .prepare(
      `SELECT po.id, po.product_id, po.overhead_item_id, oi.name AS item_name,
              po.method, po.value, po.sort_order
       FROM product_overhead po LEFT JOIN overhead_items oi ON oi.id = po.overhead_item_id
       WHERE po.id = ?`,
    )
    .get(lineId) as ProductOverheadLine | undefined
  if (!row) throw new Error(`Product overhead line #${lineId} not found.`)
  return row
}

export function updateOverheadLine(
  db: DatabaseType,
  input: UpdateProductOverheadLineInput,
): ProductOverheadLine {
  const id = requireId(input?.id, 'product overhead line')
  getOverheadLine(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['overhead_item_id'] !== undefined) {
    const oid = patch['overhead_item_id']
    const itemId = oid === null ? null : requireId(oid, 'overhead item')
    if (itemId !== null) getOverheadItem(db, itemId)
    sets.push('overhead_item_id = ?')
    values.push(itemId)
  }
  if (patch['method'] !== undefined) {
    const method = patch['method'] as OverheadMethod
    if (!OVERHEAD_METHODS.includes(method)) throw new Error(`Unknown overhead method "${patch['method']}".`)
    sets.push('method = ?')
    values.push(method)
  }
  if (patch['value'] !== undefined) {
    const v = requireDecimalText(patch['value'], 'overhead value')
    if (Number(v) < 0) throw new Error('overhead value cannot be negative.')
    sets.push('value = ?')
    values.push(v)
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length > 0) {
    values.push(id)
    db.prepare(`UPDATE product_overhead SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  return getOverheadLine(db, id)
}

export function removeOverheadLine(db: DatabaseType, lineId: ID): void {
  const id = requireId(lineId, 'product overhead line')
  getOverheadLine(db, id)
  db.prepare('DELETE FROM product_overhead WHERE id = ?').run(id)
}

export function addComponentLine(
  db: DatabaseType,
  productId: ID,
  input: NewProductComponentLineInput,
): ProductComponentLine {
  const pid = requireId(productId, 'product')
  get(db, pid)
  const componentId = requireId(input?.component_id, 'component product')
  if (componentId === pid) throw new Error('A product cannot be a component of itself.')
  get(db, componentId)
  const quantity = requireDecimalText(input?.quantity ?? '1', 'component quantity')
  if (Number(quantity) <= 0) throw new Error('component quantity must be greater than zero.')
  const info = db
    .prepare(
      `INSERT INTO product_components (product_id, component_id, quantity, sort_order)
       VALUES (?, ?, ?, ?)`,
    )
    .run(pid, componentId, quantity, input.sort_order ?? 0)
  return getComponentLine(db, info.lastInsertRowid as number)
}

function getComponentLine(db: DatabaseType, lineId: number): ProductComponentLine {
  const row = db
    .prepare(
      `SELECT pc.id, pc.product_id, pc.component_id, p.name AS component_name,
              pc.quantity, pc.sort_order
       FROM product_components pc JOIN products p ON p.id = pc.component_id
       WHERE pc.id = ?`,
    )
    .get(lineId) as ProductComponentLine | undefined
  if (!row) throw new Error(`Product component line #${lineId} not found.`)
  return row
}

export function updateComponentLine(
  db: DatabaseType,
  input: UpdateProductComponentLineInput,
): ProductComponentLine {
  const id = requireId(input?.id, 'product component line')
  const line = getComponentLine(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['component_id'] !== undefined) {
    const cid = requireId(patch['component_id'], 'component product')
    if (cid === line.product_id) throw new Error('A product cannot be a component of itself.')
    get(db, cid)
    sets.push('component_id = ?')
    values.push(cid)
  }
  if (patch['quantity'] !== undefined) {
    const q = requireDecimalText(patch['quantity'], 'component quantity')
    if (Number(q) <= 0) throw new Error('component quantity must be greater than zero.')
    sets.push('quantity = ?')
    values.push(q)
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length > 0) {
    values.push(id)
    db.prepare(`UPDATE product_components SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  return getComponentLine(db, id)
}

export function removeComponentLine(db: DatabaseType, lineId: ID): void {
  const id = requireId(lineId, 'product component line')
  getComponentLine(db, id)
  db.prepare('DELETE FROM product_components WHERE id = ?').run(id)
}

export function addOtherCostLine(
  db: DatabaseType,
  productId: ID,
  input: NewProductOtherCostLineInput,
): ProductOtherCostLine {
  const pid = requireId(productId, 'product')
  get(db, pid)
  const name = requireNonEmpty(input?.name, 'other cost name')
  const amount = requireDecimalText(input?.amount_per_unit ?? '0', 'other cost amount')
  if (Number(amount) < 0) throw new Error('other cost amount cannot be negative.')
  const info = db
    .prepare(
      `INSERT INTO product_other_costs (product_id, name, amount_per_unit, sort_order)
       VALUES (?, ?, ?, ?)`,
    )
    .run(pid, name, amount, input.sort_order ?? 0)
  return getOtherCostLine(db, info.lastInsertRowid as number)
}

function getOtherCostLine(db: DatabaseType, lineId: number): ProductOtherCostLine {
  const row = db
    .prepare(
      `SELECT id, product_id, name, amount_per_unit, sort_order
       FROM product_other_costs WHERE id = ?`,
    )
    .get(lineId) as ProductOtherCostLine | undefined
  if (!row) throw new Error(`Product other-cost line #${lineId} not found.`)
  return row
}

export function updateOtherCostLine(
  db: DatabaseType,
  input: UpdateProductOtherCostLineInput,
): ProductOtherCostLine {
  const id = requireId(input?.id, 'product other-cost line')
  getOtherCostLine(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'other cost name'))
  }
  if (patch['amount_per_unit'] !== undefined) {
    const a = requireDecimalText(patch['amount_per_unit'], 'other cost amount')
    if (Number(a) < 0) throw new Error('other cost amount cannot be negative.')
    sets.push('amount_per_unit = ?')
    values.push(a)
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length > 0) {
    values.push(id)
    db.prepare(`UPDATE product_other_costs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  return getOtherCostLine(db, id)
}

export function removeOtherCostLine(db: DatabaseType, lineId: ID): void {
  const id = requireId(lineId, 'product other-cost line')
  getOtherCostLine(db, id)
  db.prepare('DELETE FROM product_other_costs WHERE id = ?').run(id)
}

/* ------------------------------------------------------------------ */
/* buildCostInput                                                      */
/* ------------------------------------------------------------------ */

export interface MaterialPriceOverride {
  purchase_price?: string
  purchase_qty?: string
}

/** Overrides applied at build time (used by scenarios; never written to the DB). */
export interface CostOverrides {
  materials?: Record<string, MaterialPriceOverride>
  laborRates?: Record<string, string>
  wastePct?: string
  defectPct?: string
  batchSize?: number
}

const ENGINE_MATERIAL_CATEGORIES = new Set(['material', 'packaging', 'service'])

/** Read `pricey.customUnits` (JSON array) — defaults to []. */
export function readCustomUnits(db: DatabaseType): CustomUnitDef[] {
  const raw = getSetting(db, 'pricey.customUnits')
  if (!raw) return []
  try {
    const parsed = parseJson<unknown>(raw, 'pricey.customUnits')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (u): u is CustomUnitDef =>
        typeof u === 'object' &&
        u !== null &&
        typeof (u as { symbol?: unknown }).symbol === 'string' &&
        typeof (u as { dimension?: unknown }).dimension === 'string' &&
        typeof (u as { toBase?: unknown }).toBase === 'string',
    )
  } catch {
    return []
  }
}

/**
 * Build the engine's ProductCostInput for a product, resolving nested
 * components recursively. `ancestors` carries the chain of parent product
 * ids (the engine cycle-checks as well).
 */
export function buildCostInput(
  productId: ID,
  db: DatabaseType,
  ancestors: ReadonlySet<number> = new Set(),
  overrides?: CostOverrides,
): ProductCostInput {
  if (ancestors.has(productId)) {
    const product = get(db, productId)
    throw new Error(
      `Circular component reference: "${product.name}" contains itself through a component chain. ` +
        `Circular references are rejected, not recursed.`,
    )
  }
  const product = get(db, productId)

  const matRows = db
    .prepare(
      `SELECT pm.material_id, pm.quantity, pm.unit, pm.waste_pct,
              m.name, m.category, m.unit AS mat_unit, m.unit_dimension,
              m.purchase_qty, m.purchase_price
       FROM product_materials pm JOIN materials m ON m.id = pm.material_id
       WHERE pm.product_id = ? ORDER BY pm.sort_order, pm.id`,
    )
    .all(productId) as Array<{
    material_id: number
    quantity: string
    unit: string
    waste_pct: string
    name: string
    category: string
    mat_unit: string
    unit_dimension: string
    purchase_qty: string
    purchase_price: string
  }>

  const materials = matRows.map((r) => {
    const ov = overrides?.materials?.[String(r.material_id)]
    const cpu = costPerUnitOf(
      ov?.purchase_price ?? r.purchase_price,
      ov?.purchase_qty ?? r.purchase_qty,
    )
    return {
      material: {
        id: r.material_id,
        name: r.name,
        category: (ENGINE_MATERIAL_CATEGORIES.has(r.category)
          ? r.category
          : 'material') as 'material' | 'packaging' | 'service',
        unit: r.mat_unit,
        dimension: r.unit_dimension as UnitDimension,
        costPerUnit: cpu,
      },
      quantity: r.quantity,
      unit: r.unit,
      wastePct: r.waste_pct,
    }
  })

  const laborRows = db
    .prepare(
      `SELECT pl.role_id, pl.task_name, pl.mode, pl.rate, pl.quantity,
              r.name AS role_name, r.rate_per_hour AS role_rate
       FROM product_labor pl LEFT JOIN labor_roles r ON r.id = pl.role_id
       WHERE pl.product_id = ? ORDER BY pl.sort_order, pl.id`,
    )
    .all(productId) as Array<{
    role_id: number | null
    task_name: string
    mode: string
    rate: string
    quantity: string
    role_name: string | null
    role_rate: string | null
  }>

  const labor = laborRows.map((r) => {
    let rate = r.rate
    if (r.role_id !== null) {
      const ov = overrides?.laborRates?.[String(r.role_id)]
      if (ov !== undefined) rate = ov
      else if ((rate === '0' || rate === '' || rate === null) && r.role_rate) rate = r.role_rate
    }
    return {
      taskName: r.task_name || r.role_name || 'Labor',
      mode: r.mode as LaborMode,
      rate,
      quantity: r.quantity,
    }
  })

  const overheadRows = db
    .prepare(
      `SELECT po.overhead_item_id, po.method, po.value,
              oi.name AS item_name, oi.amount AS item_amount
       FROM product_overhead po LEFT JOIN overhead_items oi ON oi.id = po.overhead_item_id
       WHERE po.product_id = ? ORDER BY po.sort_order, po.id`,
    )
    .all(productId) as Array<{
    overhead_item_id: number | null
    method: string
    value: string
    item_name: string | null
    item_amount: string | null
  }>

  const batchSize = overrides?.batchSize ?? product.batch_size
  const overhead = overheadRows.map((r) => {
    const line: {
      name: string
      method: OverheadMethod
      value: string
      hourlyRate?: string
      monthlyAmount?: string
      monthlyUnits?: string
    } = {
      name: r.item_name || `${r.method} overhead`,
      method: r.method as OverheadMethod,
      value: r.value,
    }
    if (r.method === 'per_hour') {
      if (!r.item_amount) {
        throw new Error(
          `Overhead "${line.name}" uses per-hour allocation but has no linked overhead item with an hourly rate.`,
        )
      }
      line.hourlyRate = r.item_amount
    }
    if (r.method === 'monthly_share') {
      if (!r.item_amount) {
        throw new Error(
          `Overhead "${line.name}" uses monthly-share allocation but has no linked overhead item with a monthly amount.`,
        )
      }
      line.monthlyAmount = r.item_amount
      line.monthlyUnits = String(batchSize)
    }
    return line
  })

  const otherRows = db
    .prepare(
      `SELECT name, amount_per_unit FROM product_other_costs
       WHERE product_id = ? ORDER BY sort_order, id`,
    )
    .all(productId) as Array<{ name: string; amount_per_unit: string }>
  const other = otherRows.map((r) => ({ name: r.name, amountPerUnit: r.amount_per_unit }))

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(productId)
  const compRows = db
    .prepare(
      `SELECT component_id, quantity FROM product_components
       WHERE product_id = ? ORDER BY sort_order, id`,
    )
    .all(productId) as Array<{ component_id: number; quantity: string }>
  const components = compRows.map((r) => ({
    product: buildCostInput(r.component_id, db, nextAncestors, overrides),
    quantity: r.quantity,
  }))

  return {
    id: productId,
    name: product.name,
    batchSize: String(batchSize),
    materials,
    labor,
    overhead,
    other,
    components,
    wastePct: overrides?.wastePct ?? product.waste_pct,
    defectPct: overrides?.defectPct ?? product.defect_pct,
  }
}
