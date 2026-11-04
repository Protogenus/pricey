/**
 * Pricey file-exchange application logic (pricey-exchange-v1).
 *
 * - buildExport: outbound orderly.pricing-export envelope from explicit
 *   record ids (empty selection = everything).
 * - previewImport: validate + match against the live DB, returning a
 *   create/update/reject preview. NEVER writes.
 * - applyImport: applies a validated payload as NEW or UPDATED library
 *   entries, but ONLY when the caller passes confirmed: true. Snapshots are
 *   never mutated (quote snapshots import as NEW quote rows; cost_snapshots
 *   is append-only and untouched). The whole apply runs in one transaction.
 * - exchange_log: append-only audit trail of every import/export.
 *
 * Math lives in src/engine, validation shapes in src/engine/exchange.ts —
 * this file only matches rows and calls the DAOs.
 */
import Decimal from 'decimal.js'
import type { Database as DatabaseType } from 'better-sqlite3'
import {
  ExchangeError,
  buildEnvelope,
  unitDimensionOf,
  validatePayload,
  type ExchangeContractName,
  type ExchangeEnvelope,
  type ExchangeExportCostStructure,
  type ExchangeExportLabor,
  type ExchangeExportMaterial,
  type ExchangeExportOtherCost,
  type ExchangeExportOverhead,
  type ExchangeExportPricingModel,
  type ExchangeExportProduct,
  type ExchangeExportQuote,
  type ExchangeExportQuoteItem,
  type ExchangeExportScenario,
  type ExchangeLogEntry,
  type ExchangePreview,
  type ExchangeReport,
  type ExchangeRowKind,
  type ExchangeRowPreview,
  type ExchangeRowRejected,
  type ExchangeSelection,
  type ExchangeValidationCtx,
  type OrderlyPricingExportPayload,
  type RowRejection,
  type ValidElixerFormula,
  type ValidStagepointRun,
  type ValidStockroomMaterial,
  type ValidSubliumJob,
  type ValidThreadcountDesign,
  type ValidatedPayload,
} from '../engine/exchange.js'
import {
  computeProductCost,
  minimumPrice,
  priceCostPlus,
  priceFromFixedProfit,
  priceFromMargin,
  priceFromMarkup,
  validateProductCostInput,
  validatePricingParams,
  type CustomUnitDef,
  type ProductCostResult,
} from '../engine/index.js'
import type {
  Material,
  Product,
  UnitDimension,
} from '../shared/types.js'
import * as materialsDao from './materials.js'
import * as productsDao from './products.js'
import * as overheadDao from './overhead.js'
import * as pricingDao from './pricing.js'
import * as scenariosDao from './scenarios.js'
import * as quotesDao from './quotes.js'
import * as snapshotsDao from './snapshots.js'
import * as settingsDao from './settings.js'
import { nowIso, parseJson, requireId } from './util.js'
import type { CostOverrides } from './products.js'

/* ------------------------------------------------------------------ */
/* externalId bookkeeping (settings table — no schema change needed)   */
/* ------------------------------------------------------------------ */

function materialKey(contract: string, externalId: string): string {
  return `pricey.exchange.material.${contract}.${externalId}`
}

function productKey(contract: string, externalId: string): string {
  return `pricey.exchange.product.${contract}.${externalId}`
}

function findMaterialByExternalId(
  db: DatabaseType,
  contract: string,
  externalId: string,
): Material | null {
  const raw = settingsDao.get(db, materialKey(contract, externalId))
  if (!raw) return null
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return null
  try {
    return materialsDao.get(db, id)
  } catch {
    return null
  }
}

function findProductByExternalId(
  db: DatabaseType,
  contract: string,
  externalId: string,
): Product | null {
  const raw = settingsDao.get(db, productKey(contract, externalId))
  if (!raw) return null
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return null
  try {
    return productsDao.get(db, id)
  } catch {
    return null
  }
}

function findMaterialByNameUnit(db: DatabaseType, name: string, unit: string): Material | null {
  const row = db
    .prepare(
      'SELECT id FROM materials WHERE name = ? COLLATE NOCASE AND unit = ? AND archived = 0 LIMIT 1',
    )
    .get(name, unit) as { id: number } | undefined
  return row ? materialsDao.get(db, row.id) : null
}

function findProductByName(db: DatabaseType, name: string): Product | null {
  const row = db
    .prepare('SELECT id FROM products WHERE name = ? COLLATE NOCASE AND archived = 0 LIMIT 1')
    .get(name) as { id: number } | undefined
  return row ? productsDao.get(db, row.id) : null
}

function findOverheadByName(db: DatabaseType, name: string): { id: number } | null {
  const row = db
    .prepare('SELECT id FROM overhead_items WHERE name = ? COLLATE NOCASE AND archived = 0 LIMIT 1')
    .get(name) as { id: number } | undefined
  return row ?? null
}

function findMaterialLine(db: DatabaseType, productId: number, materialId: number): number | null {
  const row = db
    .prepare('SELECT id FROM product_materials WHERE product_id = ? AND material_id = ? LIMIT 1')
    .get(productId, materialId) as { id: number } | undefined
  return row ? row.id : null
}

function findLaborLineByTask(db: DatabaseType, productId: number, taskName: string): number | null {
  const row = db
    .prepare('SELECT id FROM product_labor WHERE product_id = ? AND task_name = ? LIMIT 1')
    .get(productId, taskName) as { id: number } | undefined
  return row ? row.id : null
}

function findOtherCostLineByName(
  db: DatabaseType,
  productId: number,
  name: string,
): number | null {
  const row = db
    .prepare('SELECT id FROM product_other_costs WHERE product_id = ? AND name = ? LIMIT 1')
    .get(productId, name) as { id: number } | undefined
  return row ? row.id : null
}

function findOverheadLineByItem(
  db: DatabaseType,
  productId: number,
  itemId: number,
): number | null {
  const row = db
    .prepare('SELECT id FROM product_overhead WHERE product_id = ? AND overhead_item_id = ? LIMIT 1')
    .get(productId, itemId) as { id: number } | undefined
  return row ? row.id : null
}

function quoteReferenceExists(db: DatabaseType, reference: string): boolean {
  const row = db.prepare('SELECT id FROM quotes WHERE reference = ? LIMIT 1').get(reference) as
    | { id: number }
    | undefined
  return !!row
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

interface PlannedRow {
  preview: ExchangeRowPreview
  run: (db: DatabaseType) => void
}

interface ImportPlan {
  planned: PlannedRow[]
  rejected: ExchangeRowRejected[]
}

function toRejected(kind: ExchangeRowKind, r: RowRejection): ExchangeRowRejected {
  return { kind, externalId: r.externalId, name: r.name, reasons: r.reasons }
}

/* ---------------- stockroom.material-costs ---------------- */

function planStockroom(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  materials: ValidStockroomMaterial[],
  rejected: ExchangeRowRejected[],
): ImportPlan {
  const planned: PlannedRow[] = []
  for (const m of materials) {
    const existing =
      (m.externalId ? findMaterialByExternalId(db, envelope.contract, m.externalId) : null) ??
      findMaterialByNameUnit(db, m.name, m.unit)
    if (existing) {
      if (existing.unit !== m.unit) {
        rejected.push({
          kind: 'material',
          externalId: m.externalId,
          name: m.name,
          reasons: [
            `unit: the file says "${m.unit}" but the existing material "${existing.name}" uses "${existing.unit}" — units must match to update a material.`,
          ],
        })
        continue
      }
      if (existing.unit_dimension !== m.unitDimension) {
        rejected.push({
          kind: 'material',
          externalId: m.externalId,
          name: m.name,
          reasons: [
            `unitDimension: the file declares "${m.unitDimension}" but the existing material "${existing.name}" is "${existing.unit_dimension}".`,
          ],
        })
        continue
      }
      const changes: string[] = []
      if (existing.purchase_price !== m.purchasePrice || existing.purchase_qty !== m.purchaseQty) {
        const newCpu = materialsDao.costPerUnitOf(m.purchasePrice, m.purchaseQty)
        changes.push(
          `price ${existing.purchase_qty} ${existing.unit} at ${existing.purchase_price} → ` +
            `${m.purchaseQty} ${m.unit} at ${m.purchasePrice} ` +
            `(cost per unit ${existing.cost_per_unit} → ${newCpu})`,
        )
      }
      if ((existing.supplier || '') !== m.supplier) {
        changes.push(`supplier "${existing.supplier || '—'}" → "${m.supplier || '—'}"`)
      }
      const detail = changes.length > 0 ? changes.join('; ') : 'Already up to date — nothing changes.'
      planned.push({
        preview: {
          kind: 'material',
          externalId: m.externalId,
          name: m.name,
          action: 'update',
          detail,
          changes,
        },
        run: (db) => {
          materialsDao.update(db, {
            id: existing.id,
            purchase_qty: m.purchaseQty,
            purchase_price: m.purchasePrice,
            supplier: m.supplier,
          })
          if (m.externalId) {
            settingsDao.set(db, materialKey(envelope.contract, m.externalId), String(existing.id))
          }
        },
      })
    } else {
      const cpu = materialsDao.costPerUnitOf(m.purchasePrice, m.purchaseQty)
      planned.push({
        preview: {
          kind: 'material',
          externalId: m.externalId,
          name: m.name,
          action: 'create',
          detail:
            `New material — ${m.purchaseQty} ${m.unit} at ${m.purchasePrice} ` +
            `(cost per unit ${cpu})${m.supplier ? `, supplier "${m.supplier}"` : ''}.`,
          changes: [],
        },
        run: (db) => {
          const created = materialsDao.create(db, {
            name: m.name,
            unit: m.unit,
            unit_dimension: m.unitDimension as UnitDimension,
            purchase_qty: m.purchaseQty,
            purchase_price: m.purchasePrice,
            supplier: m.supplier,
            notes: `Imported via ${envelope.contract} v${envelope.contractVersion}.`,
          })
          if (m.externalId) {
            settingsDao.set(db, materialKey(envelope.contract, m.externalId), String(created.id))
          }
        },
      })
    }
  }
  return { planned, rejected }
}

/* ---------------- shared product-line helpers ---------------- */

/** Find-or-create a library material by (name, unit); updates price when it differs. */
function ensureMaterial(
  db: DatabaseType,
  opts: {
    name: string
    unit: string
    unitDimension: string
    purchaseQty: string
    purchasePrice: string
    provenance: string
  },
): { id: number; created: boolean; priceChanged: boolean; oldCpu: string; newCpu: string } {
  const existing = findMaterialByNameUnit(db, opts.name, opts.unit)
  if (existing) {
    const priceChanged =
      existing.purchase_price !== opts.purchasePrice || existing.purchase_qty !== opts.purchaseQty
    if (priceChanged) {
      materialsDao.update(db, {
        id: existing.id,
        purchase_qty: opts.purchaseQty,
        purchase_price: opts.purchasePrice,
      })
    }
    return {
      id: existing.id,
      created: false,
      priceChanged,
      oldCpu: existing.cost_per_unit,
      newCpu: materialsDao.costPerUnitOf(opts.purchasePrice, opts.purchaseQty),
    }
  }
  const created = materialsDao.create(db, {
    name: opts.name,
    unit: opts.unit,
    unit_dimension: opts.unitDimension as UnitDimension,
    purchase_qty: opts.purchaseQty,
    purchase_price: opts.purchasePrice,
    notes: opts.provenance,
  })
  return {
    id: created.id,
    created: true,
    priceChanged: false,
    oldCpu: '0',
    newCpu: created.cost_per_unit,
  }
}

/** Upsert one product material line; returns a human-readable change note. */
function upsertMaterialLine(
  db: DatabaseType,
  productId: number,
  materialId: number,
  quantity: string,
  unit: string,
  materialName: string,
): string {
  const lineId = findMaterialLine(db, productId, materialId)
  if (lineId === null) {
    productsDao.addMaterialLine(db, productId, {
      material_id: materialId,
      quantity,
      unit,
      waste_pct: '0',
    })
    return `add material line "${materialName}" — ${quantity} ${unit}`
  }
  productsDao.updateMaterialLine(db, { id: lineId, quantity, unit })
  return `update material line "${materialName}" — ${quantity} ${unit}`
}

/** Upsert one product labor line; returns a human-readable change note. */
function upsertLaborLine(
  db: DatabaseType,
  productId: number,
  taskName: string,
  mode: 'per_minute',
  rate: string,
  quantity: string,
): string {
  const lineId = findLaborLineByTask(db, productId, taskName)
  if (lineId === null) {
    productsDao.addLaborLine(db, productId, {
      task_name: taskName,
      mode,
      rate,
      quantity,
    })
    return `add labor line "${taskName}" — ${quantity} min at ${rate}/min`
  }
  productsDao.updateLaborLine(db, { id: lineId, mode, rate, quantity })
  return `update labor line "${taskName}" — ${quantity} min at ${rate}/min`
}

/** Upsert one product other-cost line; returns a human-readable change note. */
function upsertOtherCostLine(
  db: DatabaseType,
  productId: number,
  name: string,
  amountPerUnit: string,
): string {
  const lineId = findOtherCostLineByName(db, productId, name)
  if (lineId === null) {
    productsDao.addOtherCostLine(db, productId, { name, amount_per_unit: amountPerUnit })
    return `add other cost "${name}" — ${amountPerUnit}/unit`
  }
  productsDao.updateOtherCostLine(db, { id: lineId, amount_per_unit: amountPerUnit })
  return `update other cost "${name}" — ${amountPerUnit}/unit`
}

function intBatchSize(decimalText: string): number {
  const d = new Decimal(decimalText)
  return d.isInteger() && d.gt(0) && d.lte(Number.MAX_SAFE_INTEGER) ? d.toNumber() : 1
}

/* ---------------- elixer.formula-costs ---------------- */

function planElixer(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  formula: ValidElixerFormula | null,
  rejected: ExchangeRowRejected[],
  ctx: ExchangeValidationCtx,
): ImportPlan {
  const planned: PlannedRow[] = []
  if (!formula) return { planned, rejected }
  const f = formula
  const provenance = `Imported via ${envelope.contract} v${envelope.contractVersion}.`

  // Ingredient materials are separate preview rows so the user sees every
  // library change before confirming. Planning is read-only; the run()
  // closures do the writes, in plan order (materials before the product).
  const ingredientPlan: Array<{
    ing: { name: string; qty: string; unit: string; costPerUnit: string; costUnit: string }
    dim: string
  }> = []
  for (const ing of f.ingredients) {
    const dim = unitDimensionOf(ing.costUnit, ctx)
    ingredientPlan.push({ ing, dim })
    const existing = findMaterialByNameUnit(db, ing.name, ing.costUnit)
    const newCpu = materialsDao.costPerUnitOf(ing.costPerUnit, '1')
    if (!existing) {
      planned.push({
        preview: {
          kind: 'material',
          name: ing.name,
          action: 'create',
          detail: `New material for Elixer formula "${f.name}" — 1 ${ing.costUnit} at ${ing.costPerUnit} (cost per unit ${newCpu}).`,
          changes: [],
        },
        run: (db) => {
          ensureMaterial(db, {
            name: ing.name,
            unit: ing.costUnit,
            unitDimension: dim,
            purchaseQty: '1',
            purchasePrice: ing.costPerUnit,
            provenance,
          })
        },
      })
    } else if (existing.purchase_price !== ing.costPerUnit || existing.purchase_qty !== '1') {
      planned.push({
        preview: {
          kind: 'material',
          name: ing.name,
          action: 'update',
          detail: `Price update from Elixer formula "${f.name}" — cost per unit ${existing.cost_per_unit} → ${newCpu}.`,
          changes: [`cost per unit ${existing.cost_per_unit} → ${newCpu}`],
        },
        run: (db) => {
          ensureMaterial(db, {
            name: ing.name,
            unit: ing.costUnit,
            unitDimension: dim,
            purchaseQty: '1',
            purchasePrice: ing.costPerUnit,
            provenance,
          })
        },
      })
    }
  }

  const existing =
    (f.externalId ? findProductByExternalId(db, envelope.contract, f.externalId) : null) ??
    findProductByName(db, f.name)
  const batchSize = intBatchSize(f.yieldQty)
  // Pricey material lines are per-unit quantities; the formula's ingredient
  // amounts are for the whole yield, so each line gets qty / yieldQty.
  const perUnitQty = (qty: string): string => new Decimal(qty).div(f.yieldQty).toString()
  const lineDesc = (ing: { name: string; qty: string; unit: string }): string =>
    `ingredient "${ing.name}" — ${perUnitQty(ing.qty)} ${ing.unit}/unit`

  if (existing) {
    planned.push({
      preview: {
        kind: 'product',
        externalId: f.externalId,
        name: f.name,
        action: 'update',
        detail: `Update product from Elixer formula — ${f.ingredients.length} ingredient line(s), quantities per unit of a ${f.yieldQty}-${f.yieldUnit} yield; existing lines not in the formula are kept.`,
        changes: f.ingredients.map(lineDesc),
      },
      run: (db) => {
        for (const { ing } of ingredientPlan) {
          const matId = findMaterialByNameUnit(db, ing.name, ing.costUnit)!.id
          upsertMaterialLine(db, existing.id, matId, perUnitQty(ing.qty), ing.unit, ing.name)
        }
        if (f.externalId) {
          settingsDao.set(db, productKey(envelope.contract, f.externalId), String(existing.id))
        }
      },
    })
  } else {
    planned.push({
      preview: {
        kind: 'product',
        externalId: f.externalId,
        name: f.name,
        action: 'create',
        detail: `New product from Elixer formula — batch size ${batchSize} ${f.yieldUnit}, ${f.ingredients.length} ingredient line(s) at per-unit quantities.`,
        changes: [],
      },
      run: (db) => {
        const created = productsDao.create(db, {
          name: f.name,
          batch_size: batchSize,
          unit_of_sale: f.yieldUnit,
          notes: provenance,
        })
        for (const { ing } of ingredientPlan) {
          const matId = findMaterialByNameUnit(db, ing.name, ing.costUnit)!.id
          upsertMaterialLine(db, created.id, matId, perUnitQty(ing.qty), ing.unit, ing.name)
        }
        if (f.externalId) {
          settingsDao.set(db, productKey(envelope.contract, f.externalId), String(created.id))
        }
      },
    })
  }
  return { planned, rejected }
}

/* ---------------- stagepoint.production-costs ---------------- */

function planStagepoint(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  run: ValidStagepointRun | null,
  rejected: ExchangeRowRejected[],
): ImportPlan {
  const planned: PlannedRow[] = []
  if (!run) return { planned, rejected }
  const provenance = `Imported via ${envelope.contract} v${envelope.contractVersion}.`
  const batchSize = intBatchSize(run.quantity)
  const otherName = `Materials — ${run.name}`
  const laborTask = `Production labor — ${run.name}`
  const amountPerUnit = new Decimal(run.materialCostTotal).div(run.quantity).toString()
  const laborRate = new Decimal(run.laborRatePerHour).div(60).toString()
  const laborQty = new Decimal(run.laborMinutes).div(run.quantity).toString()

  const existing =
    (run.externalId ? findProductByExternalId(db, envelope.contract, run.externalId) : null) ??
    findProductByName(db, run.name)
  const changes = [
    `other cost "${otherName}" — ${amountPerUnit}/unit`,
    `labor "${laborTask}" — ${laborQty} min at ${laborRate}/min`,
  ]

  if (existing) {
    planned.push({
      preview: {
        kind: 'product',
        externalId: run.externalId,
        name: run.name,
        action: 'update',
        detail: `Update product from StagePoint run — ${changes.join('; ')}.`,
        changes,
      },
      run: (db) => {
        upsertOtherCostLine(db, existing.id, otherName, amountPerUnit)
        upsertLaborLine(db, existing.id, laborTask, 'per_minute', laborRate, laborQty)
        if (run.externalId) {
          settingsDao.set(db, productKey(envelope.contract, run.externalId), String(existing.id))
        }
      },
    })
  } else {
    planned.push({
      preview: {
        kind: 'product',
        externalId: run.externalId,
        name: run.name,
        action: 'create',
        detail: `New product from StagePoint run — batch of ${run.quantity}, ${changes.join('; ')}.`,
        changes: [],
      },
      run: (db) => {
        const created = productsDao.create(db, {
          name: run.name,
          batch_size: batchSize,
          notes: [provenance, run.notes].filter(Boolean).join(' '),
        })
        upsertOtherCostLine(db, created.id, otherName, amountPerUnit)
        upsertLaborLine(db, created.id, laborTask, 'per_minute', laborRate, laborQty)
        if (run.externalId) {
          settingsDao.set(db, productKey(envelope.contract, run.externalId), String(created.id))
        }
      },
    })
  }
  return { planned, rejected }
}

/* ---------------- sublium / threadcount (per-unit job imports) ---------------- */

interface JobImportSpec {
  contract: string
  externalId?: string
  name: string
  materialSpecs: Array<{ name: string; costPerUnit: string }>
  laborTask: string
  laborRatePerHour: string
  laborMinutesPerUnit: string
}

function planJobImport(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  spec: JobImportSpec | null,
  rejected: ExchangeRowRejected[],
  ctx: ExchangeValidationCtx,
): ImportPlan {
  const planned: PlannedRow[] = []
  if (!spec) return { planned, rejected }
  const provenance = `Imported via ${envelope.contract} v${envelope.contractVersion}.`
  const laborRate = new Decimal(spec.laborRatePerHour).div(60).toString()

  // Planning is read-only; material rows run before the product row.
  for (const ms of spec.materialSpecs) {
    const dim = unitDimensionOf('piece', ctx)
    const existing = findMaterialByNameUnit(db, ms.name, 'piece')
    const newCpu = materialsDao.costPerUnitOf(ms.costPerUnit, '1')
    if (!existing) {
      planned.push({
        preview: {
          kind: 'material',
          name: ms.name,
          action: 'create',
          detail: `New material for "${spec.name}" — 1 piece at ${ms.costPerUnit}.`,
          changes: [],
        },
        run: (db) => {
          ensureMaterial(db, {
            name: ms.name,
            unit: 'piece',
            unitDimension: dim,
            purchaseQty: '1',
            purchasePrice: ms.costPerUnit,
            provenance,
          })
        },
      })
    } else if (existing.purchase_price !== ms.costPerUnit || existing.purchase_qty !== '1') {
      planned.push({
        preview: {
          kind: 'material',
          name: ms.name,
          action: 'update',
          detail: `Price update from "${spec.name}" — cost per unit ${existing.cost_per_unit} → ${newCpu}.`,
          changes: [`cost per unit ${existing.cost_per_unit} → ${newCpu}`],
        },
        run: (db) => {
          ensureMaterial(db, {
            name: ms.name,
            unit: 'piece',
            unitDimension: dim,
            purchaseQty: '1',
            purchasePrice: ms.costPerUnit,
            provenance,
          })
        },
      })
    }
  }

  const existing =
    (spec.externalId ? findProductByExternalId(db, spec.contract, spec.externalId) : null) ??
    findProductByName(db, spec.name)
  const lineChanges = [
    ...spec.materialSpecs.map((ms) => `material line "${ms.name}" — 1 piece`),
    `labor "${spec.laborTask}" — ${spec.laborMinutesPerUnit} min at ${laborRate}/min`,
  ]

  const applyLines = (db: DatabaseType, productId: number) => {
    for (const ms of spec.materialSpecs) {
      const matId = findMaterialByNameUnit(db, ms.name, 'piece')!.id
      upsertMaterialLine(db, productId, matId, '1', 'piece', ms.name)
    }
    upsertLaborLine(db, productId, spec.laborTask, 'per_minute', laborRate, spec.laborMinutesPerUnit)
  }

  if (existing) {
    planned.push({
      preview: {
        kind: 'product',
        externalId: spec.externalId,
        name: spec.name,
        action: 'update',
        detail: `Update product — ${lineChanges.join('; ')}.`,
        changes: lineChanges,
      },
      run: (db) => {
        applyLines(db, existing.id)
        if (spec.externalId) {
          settingsDao.set(db, productKey(spec.contract, spec.externalId), String(existing.id))
        }
      },
    })
  } else {
    planned.push({
      preview: {
        kind: 'product',
        externalId: spec.externalId,
        name: spec.name,
        action: 'create',
        detail: `New product — ${lineChanges.join('; ')}.`,
        changes: [],
      },
      run: (db) => {
        const created = productsDao.create(db, { name: spec.name, notes: provenance })
        applyLines(db, created.id)
        if (spec.externalId) {
          settingsDao.set(db, productKey(spec.contract, spec.externalId), String(created.id))
        }
      },
    })
  }
  return { planned, rejected }
}

/* ---------------- orderly.pricing-export (Pricey transfer) ---------------- */

function applyTransferStructure(
  db: DatabaseType,
  productId: number,
  cs: ExchangeExportCostStructure | undefined,
  changes: string[],
): void {
  if (!cs) return
  for (const em of cs.materials ?? []) {
    if (!em || typeof em.name !== 'string' || !em.name.trim()) continue
    const ensured = ensureMaterial(db, {
      name: em.name.trim(),
      unit: typeof em.unit === 'string' && em.unit ? em.unit : 'piece',
      unitDimension:
        typeof em.unitDimension === 'string' && em.unitDimension ? em.unitDimension : 'count',
      purchaseQty: typeof em.purchaseQty === 'string' && em.purchaseQty ? em.purchaseQty : '1',
      purchasePrice:
        typeof em.purchasePrice === 'string' && em.purchasePrice ? em.purchasePrice : '0',
      provenance: 'Transferred from a Pricey export.',
    })
    changes.push(
      upsertMaterialLine(
        db,
        productId,
        ensured.id,
        typeof em.lineQuantity === 'string' && em.lineQuantity ? em.lineQuantity : '0',
        typeof em.lineUnit === 'string' && em.lineUnit ? em.lineUnit : 'piece',
        em.name.trim(),
      ),
    )
  }
  for (const el of cs.labor ?? []) {
    if (!el) continue
    const taskName =
      typeof el.taskName === 'string' && el.taskName.trim() ? el.taskName.trim() : 'Labor'
    const mode = el.mode === 'per_minute' || el.mode === 'per_unit' || el.mode === 'fixed' ? el.mode : 'hourly'
    // Labor role links do not transfer between databases; the rate travels on the line.
    const lineId = findLaborLineByTask(db, productId, taskName)
    const rate = typeof el.rate === 'string' ? el.rate : '0'
    const quantity = typeof el.quantity === 'string' ? el.quantity : '0'
    if (lineId === null) {
      productsDao.addLaborLine(db, productId, { task_name: taskName, mode, rate, quantity })
      changes.push(`add labor line "${taskName}" — ${quantity} at ${rate} (${mode})`)
    } else {
      productsDao.updateLaborLine(db, { id: lineId, mode, rate, quantity })
      changes.push(`update labor line "${taskName}" — ${quantity} at ${rate} (${mode})`)
    }
  }
  for (const eo of cs.overhead ?? []) {
    if (!eo || typeof eo.name !== 'string' || !eo.name.trim()) continue
    let item = findOverheadByName(db, eo.name.trim())
    if (!item) {
      const created = overheadDao.create(db, {
        name: eo.name.trim(),
        amount: '0',
        notes: 'Transferred from a Pricey export.',
      })
      item = { id: created.id }
    }
    const method =
      eo.method === 'per_batch' ||
      eo.method === 'pct_of_direct' ||
      eo.method === 'per_hour' ||
      eo.method === 'monthly_share'
        ? eo.method
        : 'per_unit'
    const value = typeof eo.value === 'string' ? eo.value : '0'
    const lineId = findOverheadLineByItem(db, productId, item.id)
    if (lineId === null) {
      productsDao.addOverheadLine(db, productId, {
        overhead_item_id: item.id,
        method,
        value,
      })
      changes.push(`add overhead line "${eo.name.trim()}" (${method})`)
    } else {
      productsDao.updateOverheadLine(db, { id: lineId, method, value })
      changes.push(`update overhead line "${eo.name.trim()}" (${method})`)
    }
  }
  for (const oc of cs.otherCosts ?? []) {
    if (!oc || typeof oc.name !== 'string' || !oc.name.trim()) continue
    const amount = typeof oc.amountPerUnit === 'string' ? oc.amountPerUnit : '0'
    changes.push(upsertOtherCostLine(db, productId, oc.name.trim(), amount))
  }
}

function planOrderly(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  transfer: OrderlyPricingExportPayload,
  rejected: ExchangeRowRejected[],
): ImportPlan {
  const planned: PlannedRow[] = []
  const kindFor = (name: string): ExchangeRowKind =>
    name.startsWith('pricingModels')
      ? 'pricingConfig'
      : name.startsWith('scenarios')
        ? 'scenario'
        : name.startsWith('quoteSnapshots')
          ? 'quote'
          : 'product'
  // engine-level structural rejections arrive without a kind; map them here.
  const mappedRejected: ExchangeRowRejected[] = rejected.map((r) => ({
    ...r,
    kind: kindFor(r.name),
  }))

  const structures = new Map(
    (transfer.costStructures ?? []).map((cs) => [cs.productName, cs]),
  )
  // Products planned in THIS import are not in the DB yet during planning
  // (preview never writes). Track them by name so pricing models and
  // scenarios can resolve against them; apply() runs products first.
  const plannedProductNames = new Set<string>()
  const resolveProduct = (name: string): Product | null =>
    findProductByName(db, name) ?? (plannedProductNames.has(name.toLowerCase()) ? ({ id: -1 }) as Product : null)

  // Products first — pricing models, scenarios and quotes resolve against them.
  for (const p of transfer.products ?? []) {
    plannedProductNames.add(p.name.toLowerCase())
    const existing = findProductByName(db, p.name)
    const cs = structures.get(p.name)
    if (existing) {
      const changes: string[] = []
      planned.push({
        preview: {
          kind: 'product',
          name: p.name,
          action: 'update',
          detail: `Update transferred product "${p.name}" (sku ${p.sku || '—'}) with its exported cost structure.`,
          changes,
        },
        run: (db) => {
          productsDao.update(db, {
            id: existing.id,
            sku: p.sku ?? '',
            category: p.category ?? '',
            unit_of_sale: p.unitOfSale ?? 'piece',
            batch_size: p.batchSize ?? 1,
            waste_pct: p.wastePct ?? '0',
            defect_pct: p.defectPct ?? '0',
          })
          applyTransferStructure(db, existing.id, cs, changes)
        },
      })
    } else {
      planned.push({
        preview: {
          kind: 'product',
          name: p.name,
          action: 'create',
          detail: `New transferred product "${p.name}" (sku ${p.sku || '—'}) with its exported cost structure.`,
          changes: [],
        },
        run: (db) => {
          const created = productsDao.create(db, {
            name: p.name,
            sku: p.sku ?? '',
            category: p.category ?? '',
            unit_of_sale: p.unitOfSale ?? 'piece',
            batch_size: p.batchSize ?? 1,
            waste_pct: p.wastePct ?? '0',
            defect_pct: p.defectPct ?? '0',
            notes: 'Transferred from a Pricey export.',
          })
          applyTransferStructure(db, created.id, cs, [])
        },
      })
    }
  }

  for (const pm of transfer.pricingModels ?? []) {
    const product = resolveProduct(pm.productName)
    if (!product) {
      mappedRejected.push({
        kind: 'pricingConfig',
        name: String(pm.name ?? pm.productName),
        reasons: [
          `pricing model "${pm.name}": product "${pm.productName}" was not transferred — pricing models need their product.`,
        ],
      })
      continue
    }
    const productName = pm.productName
    const existingCfg = product.id > 0
      ? (db
          .prepare('SELECT id FROM pricing_configs WHERE product_id = ? AND name = ? LIMIT 1')
          .get(product.id, pm.name) as { id: number } | undefined)
      : undefined
    const paramsJson = JSON.stringify(pm.params ?? {})
    if (existingCfg) {
      planned.push({
        preview: {
          kind: 'pricingConfig',
          name: String(pm.name),
          action: 'update',
          detail: `Update pricing model "${pm.name}" on "${pm.productName}" (${pm.method}, ${pm.channel}).`,
          changes: [],
        },
        run: (db) => {
          pricingDao.updatePricingConfig(db, {
            id: existingCfg.id,
            channel: pm.channel as 'retail' | 'wholesale' | 'custom',
            method: pm.method as 'margin' | 'markup' | 'fixed_profit' | 'target_profit' | 'minimum' | 'cost_plus' | 'reference',
            params_json: paramsJson,
          })
        },
      })
    } else {
      planned.push({
        preview: {
          kind: 'pricingConfig',
          name: String(pm.name),
          action: 'create',
          detail: `New pricing model "${pm.name}" on "${pm.productName}" (${pm.method}, ${pm.channel}).`,
          changes: [],
        },
        run: (db) => {
          // Re-resolve at apply time: the product row runs before this one.
          const prod = findProductByName(db, productName)
          if (!prod) throw new Error(`Import order error: product "${productName}" was not created before its pricing model.`)
          pricingDao.createPricingConfig(db, {
            product_id: prod.id,
            name: String(pm.name),
            channel: pm.channel as 'retail' | 'wholesale' | 'custom',
            method: pm.method as 'margin' | 'markup' | 'fixed_profit' | 'target_profit' | 'minimum' | 'cost_plus' | 'reference',
            params_json: paramsJson,
          })
        },
      })
    }
  }

  for (const sc of transfer.scenarios ?? []) {
    const product = resolveProduct(sc.productName)
    if (!product) {
      mappedRejected.push({
        kind: 'scenario',
        name: String(sc.name ?? sc.productName),
        reasons: [
          `scenario "${sc.name}": product "${sc.productName}" was not transferred — scenarios need their product.`,
        ],
      })
      continue
    }
    const productName = sc.productName
    const existingSc = product.id > 0
      ? (db
          .prepare('SELECT id FROM scenarios WHERE product_id = ? AND name = ? LIMIT 1')
          .get(product.id, sc.name) as { id: number } | undefined)
      : undefined
    if (existingSc) {
      planned.push({
        preview: {
          kind: 'scenario',
          name: String(sc.name),
          action: 'update',
          detail: `Update scenario "${sc.name}" on "${sc.productName}".`,
          changes: [],
        },
        run: (db) => {
          scenariosDao.update(db, {
            id: existingSc.id,
            base_snapshot_json: sc.baseSnapshotJson ?? '{}',
            overrides_json: sc.overridesJson ?? '{}',
            notes: sc.notes ?? '',
          })
        },
      })
    } else {
      planned.push({
        preview: {
          kind: 'scenario',
          name: String(sc.name),
          action: 'create',
          detail: `New scenario "${sc.name}" on "${sc.productName}".`,
          changes: [],
        },
        run: (db) => {
          // Re-resolve at apply time: the product row runs before this one.
          const prod = findProductByName(db, productName)
          if (!prod) throw new Error(`Import order error: product "${productName}" was not created before its scenario.`)
          scenariosDao.create(db, {
            product_id: prod.id,
            name: String(sc.name),
            base_snapshot_json: sc.baseSnapshotJson ?? '{}',
            overrides_json: sc.overridesJson ?? '{}',
            notes: sc.notes ?? '',
          })
        },
      })
    }
  }

  for (const q of transfer.quoteSnapshots ?? []) {
    if (quoteReferenceExists(db, q.reference)) {
      mappedRejected.push({
        kind: 'quote',
        name: q.reference,
        reasons: [
          `reference: quote "${q.reference}" already exists — quotes are frozen snapshots and are never overwritten.`,
        ],
      })
      continue
    }
    const items: ExchangeExportQuoteItem[] = Array.isArray(q.items) ? q.items : []
    planned.push({
      preview: {
        kind: 'quote',
        name: q.reference,
        action: 'create',
        detail: `New frozen quote "${q.reference}" — total ${q.total} (${items.length} item(s)). Imported quotes are new rows; existing quotes are never touched.`,
        changes: [],
      },
      run: (db) => {
        // Direct insert: quotesDao.create would RECOMPUTE totals from live
        // products, destroying the frozen snapshot. The exported totals are
        // the frozen truth and are carried over verbatim.
        const now = nowIso()
        const info = db
          .prepare(
            `INSERT INTO quotes
               (reference, customer_name, customer_contact, quote_date, expires_at,
                business_info_json, terms, notes, discount_type, discount_value,
                tax_label, tax_rate, tax_mode, shipping,
                subtotal, discount_total, tax_total, shipping_total, total,
                snapshot_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, '{}', '', '', 'none', '0', 'Tax', '0', 'exclusive', '0',
                     ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          )
          .run(
            q.reference,
            q.customerName ?? '',
            '',
            q.quoteDate ?? now.slice(0, 10),
            q.expiresAt ?? '',
            q.subtotal ?? '0',
            q.discountTotal ?? '0',
            q.taxTotal ?? '0',
            q.shippingTotal ?? '0',
            q.total ?? '0',
            JSON.stringify(q.frozenAssumptions ?? {}),
            now,
            now,
          )
        const quoteId = info.lastInsertRowid as number
        const insertItem = db.prepare(
          `INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, sort_order)
           VALUES (?, NULL, ?, ?, ?, ?)`,
        )
        items.forEach((it, i) => {
          insertItem.run(
            quoteId,
            String(it.description ?? ''),
            String(it.quantity ?? '1'),
            String(it.unitPrice ?? '0'),
            i,
          )
        })
      },
    })
  }

  return { planned, rejected: mappedRejected }
}

/* ------------------------------------------------------------------ */
/* planImport dispatch                                                 */
/* ------------------------------------------------------------------ */

function planImport(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  validated: ValidatedPayload,
  ctx: ExchangeValidationCtx,
): ImportPlan {
  switch (validated.contract) {
    case 'stockroom.material-costs':
      return planStockroom(
        db,
        envelope,
        validated.data.materials,
        validated.data.rejected.map((r) => toRejected('material', r)),
      )
    case 'elixer.formula-costs':
      return planElixer(
        db,
        envelope,
        validated.data.formula,
        validated.data.rejected.map((r) => toRejected('product', r)),
        ctx,
      )
    case 'stagepoint.production-costs':
      return planStagepoint(
        db,
        envelope,
        validated.data.run,
        validated.data.rejected.map((r) => toRejected('product', r)),
      )
    case 'sublium.production-costs': {
      const j: ValidSubliumJob | null = validated.data.job
      return planJobImport(
        db,
        envelope,
        j
          ? {
              contract: envelope.contract,
              externalId: j.externalId,
              name: j.name,
              materialSpecs: [
                { name: `${j.name} — blank`, costPerUnit: j.blankCostPerUnit },
                { name: `${j.name} — ink`, costPerUnit: j.inkCostPerUnit },
              ],
              laborTask: `Press — ${j.name}`,
              laborRatePerHour: j.laborRatePerHour,
              laborMinutesPerUnit: j.pressMinutesPerUnit,
            }
          : null,
        validated.data.rejected.map((r) => toRejected('product', r)),
        ctx,
      )
    }
    case 'threadcount.production-costs': {
      const d: ValidThreadcountDesign | null = validated.data.design
      return planJobImport(
        db,
        envelope,
        d
          ? {
              contract: envelope.contract,
              externalId: d.externalId,
              name: d.name,
              materialSpecs: [
                { name: `${d.name} — thread`, costPerUnit: d.threadCostPerUnit },
                { name: `${d.name} — stabilizer`, costPerUnit: d.stabilizerCostPerUnit },
              ],
              laborTask: `Production — ${d.name}`,
              laborRatePerHour: d.machineRatePerHour,
              laborMinutesPerUnit: d.productionMinutesPerUnit,
            }
          : null,
        validated.data.rejected.map((r) => toRejected('product', r)),
        ctx,
      )
    }
    case 'orderly.pricing-export':
      return planOrderly(
        db,
        envelope,
        validated.data.transfer,
        validated.data.rejected.map((r) => ({ ...r, kind: 'product' as ExchangeRowKind })),
      )
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface ExchangeApplyOpts {
  confirmed: boolean
  customUnits: CustomUnitDef[]
  /** File path for the audit log; '' when not from a file. */
  filename?: string
}

/** Validate + match, no writes. Throws ExchangeError on structural failure. */
export function previewImport(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  customUnits: CustomUnitDef[],
): ExchangePreview {
  const ctx: ExchangeValidationCtx = { customUnits }
  const validated = validatePayload(envelope, ctx)
  const plan = planImport(db, envelope, validated, ctx)
  const rows = plan.planned.map((p) => p.preview)
  return {
    contract: envelope.contract,
    contractVersion: envelope.contractVersion,
    producer: envelope.producer,
    producerVersion: envelope.producerVersion,
    exportedAt: envelope.exportedAt,
    totals: {
      create: rows.filter((r) => r.action === 'create').length,
      update: rows.filter((r) => r.action === 'update').length,
      rejected: plan.rejected.length,
    },
    rows,
    rejected: plan.rejected,
  }
}

/**
 * Apply a validated payload. Requires confirmed: true — the caller must have
 * shown the preview first. Runs in a single transaction; any unexpected
 * failure rolls everything back.
 */
export function applyImport(
  db: DatabaseType,
  envelope: ExchangeEnvelope,
  opts: ExchangeApplyOpts,
): ExchangeReport {
  if (!opts.confirmed) {
    throw new ExchangeError(
      'Import was not confirmed. Review the preview first, then confirm explicitly — nothing was written.',
    )
  }
  const ctx: ExchangeValidationCtx = { customUnits: opts.customUnits }
  const validated = validatePayload(envelope, ctx)
  const plan = planImport(db, envelope, validated, ctx)
  const tx = db.transaction(() => {
    for (const p of plan.planned) p.run(db)
  })
  tx()
  const applied = plan.planned.map((p) => p.preview)
  const created = applied.filter((r) => r.action === 'create').length
  const updated = applied.filter((r) => r.action === 'update').length
  const logId = logExchange(db, {
    direction: 'import',
    contract: envelope.contract,
    filename: opts.filename ?? '',
    recordsCreated: created,
    recordsUpdated: updated,
    recordsRejected: plan.rejected.length,
  })
  return {
    contract: envelope.contract,
    created,
    updated,
    rejected: plan.rejected.length,
    applied,
    rejectedRows: plan.rejected,
    logId,
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ExchangeBuildOpts {
  appVersion: string
  customUnits: CustomUnitDef[]
}

export interface ExportCounts {
  products: number
  pricingConfigs: number
  scenarios: number
  quotes: number
}

/** Mirror of the pricing-method math in src/main/ipc.ts (methodPrice). */
function methodUnitPrice(
  method: string,
  unitCost: Decimal,
  costResult: ProductCostResult,
  params: Record<string, unknown>,
  configName: string,
): Decimal {
  const strParam = (field: string): string => {
    const v = params[field]
    if (v === undefined || v === null || String(v).trim() === '') {
      throw new ExchangeError(
        `Cannot export pricing "${configName}": pricing param "${field}" is missing.`,
      )
    }
    return String(v)
  }
  switch (method) {
    case 'margin':
      return priceFromMargin(unitCost, strParam('margin'))
    case 'markup':
      return priceFromMarkup(unitCost, strParam('markup'))
    case 'fixed_profit':
    case 'target_profit':
      return priceFromFixedProfit(unitCost, strParam('profit'))
    case 'minimum':
      return minimumPrice(
        params['coveredCosts'] !== undefined ? String(params['coveredCosts']) : unitCost,
        params['requiredProfit'] !== undefined ? String(params['requiredProfit']) : '0',
      )
    case 'cost_plus': {
      // Mirrors costPlusCategories in src/main/ipc.ts.
      const markups = (params['markups'] ?? {}) as Record<string, unknown>
      return priceCostPlus([
        {
          name: 'Materials',
          cost: new Decimal(costResult.materialCost)
            .plus(costResult.packagingCost)
            .plus(costResult.serviceCost)
            .plus(costResult.wasteCost)
            .toString(),
          markup: String(markups['material'] ?? '0'),
        },
        { name: 'Labor', cost: costResult.laborCost, markup: String(markups['labor'] ?? '0') },
        { name: 'Overhead', cost: costResult.overheadCost, markup: String(markups['overhead'] ?? '0') },
        {
          name: 'Other & components',
          cost: new Decimal(costResult.otherDirectCost).plus(costResult.componentCost).toString(),
          markup: String(markups['other'] ?? '0'),
        },
      ])
    }
    case 'reference':
      return new Decimal(strParam('refPrice'))
    default:
      throw new ExchangeError(
        `Cannot export pricing "${configName}": unknown pricing method "${method}".`,
      )
  }
}

/**
 * Build the outbound orderly.pricing-export envelope. unitPrice is the
 * pricing-method price on the product's unit cost, before channel fees and
 * rounding (exact decimal strings) — channel fees stay Pricey-side.
 */
export function buildExport(
  db: DatabaseType,
  contract: string,
  selection: ExchangeSelection,
  opts: ExchangeBuildOpts,
): { envelope: ExchangeEnvelope; counts: ExportCounts } {
  if (contract !== 'orderly.pricing-export') {
    throw new ExchangeError(
      `Pricey only exports "${'orderly.pricing-export' satisfies ExchangeContractName}" — "${contract}" is inbound-only.`,
    )
  }
  const currency = settingsDao.get(db, 'pricey.currency') || 'USD'

  const productIds =
    selection.productIds && selection.productIds.length > 0
      ? selection.productIds.map((id) => requireId(id, 'product'))
      : productsDao.list(db).map((p) => p.id)

  const costCache = new Map<number, ProductCostResult>()
  const costOf = (productId: number): ProductCostResult => {
    const hit = costCache.get(productId)
    if (hit) return hit
    const product = productsDao.get(db, productId)
    const input = productsDao.buildCostInput(productId, db, new Set())
    const problems = validateProductCostInput(input, opts.customUnits)
    if (problems.length > 0) {
      throw new ExchangeError(`Cannot export product "${product.name}": ${problems.join(' ')}`)
    }
    const result = computeProductCost(input, opts.customUnits)
    costCache.set(productId, result)
    return result
  }

  const products: ExchangeExportProduct[] = []
  const costStructures: ExchangeExportCostStructure[] = []
  const pricings: OrderlyPricingExportPayload['pricings'] = []
  const pricingModels: ExchangeExportPricingModel[] = []
  const scenarios: ExchangeExportScenario[] = []
  let pricingConfigCount = 0
  let scenarioCount = 0

  for (const pid of productIds) {
    const p = productsDao.get(db, pid)
    const full = productsDao.getFull(db, pid)
    const cost = costOf(pid)

    products.push({
      name: p.name,
      sku: p.sku,
      category: p.category,
      unitOfSale: p.unit_of_sale,
      batchSize: p.batch_size,
      wastePct: p.waste_pct,
      defectPct: p.defect_pct,
      costPerUnit: cost.totalUnitCost,
    })
    const structure: ExchangeExportCostStructure = {
      productName: p.name,
      materials: full.materials.map((l) => {
        const m = materialsDao.get(db, l.material_id)
        const em: ExchangeExportMaterial = {
          name: m.name,
          unit: m.unit,
          unitDimension: m.unit_dimension,
          purchaseQty: m.purchase_qty,
          purchasePrice: m.purchase_price,
          lineQuantity: l.quantity,
          lineUnit: l.unit,
          lineWastePct: l.waste_pct,
        }
        return em
      }),
      labor: full.labor.map((l) => {
        const el: ExchangeExportLabor = {
          taskName: l.task_name || l.role_name || 'Labor',
          mode: l.mode,
          rate: l.rate,
          quantity: l.quantity,
        }
        return el
      }),
      overhead: full.overhead.map((l) => {
        const eo: ExchangeExportOverhead = {
          name: l.item_name || `${l.method} overhead`,
          method: l.method,
          value: l.value,
        }
        return eo
      }),
      otherCosts: full.other_costs.map((l) => {
        const eoc: ExchangeExportOtherCost = { name: l.name, amountPerUnit: l.amount_per_unit }
        return eoc
      }),
    }
    costStructures.push(structure)

    const configs =
      selection.pricingConfigIds && selection.pricingConfigIds.length > 0
        ? selection.pricingConfigIds
            .map((id) => pricingDao.getPricingConfig(db, requireId(id, 'pricing config')))
            .filter((c) => c.product_id === pid)
        : pricingDao.listPricingConfigs(db, pid)
    for (const cfg of configs) {
      const params = parseJson<Record<string, unknown>>(
        cfg.params_json || '{}',
        `pricing params for "${cfg.name}"`,
      )
      if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        throw new ExchangeError(`Cannot export pricing "${cfg.name}": params must be a JSON object.`)
      }
      const paramProblems = validatePricingParams(cfg.method, params)
      if (paramProblems.length > 0) {
        throw new ExchangeError(
          `Cannot export pricing "${cfg.name}": ${paramProblems.join(' ')}`,
        )
      }
      const unitPrice = methodUnitPrice(
        cfg.method,
        new Decimal(cost.totalUnitCost),
        cost,
        params,
        cfg.name,
      )
      const snapshot = snapshotsDao.create(db, {
        kind: 'exchange',
        product_id: pid,
        label: `Exchange export — ${p.name} — ${cfg.name}`,
        snapshot_json: JSON.stringify(cost),
      })
      pricings.push({
        productName: p.name,
        sku: p.sku,
        channel: cfg.channel,
        unitPrice: unitPrice.toString(),
        currency,
        snapshotId: snapshot.id,
      })
      pricingModels.push({
        productName: p.name,
        name: cfg.name,
        channel: cfg.channel,
        method: cfg.method,
        params,
      })
      pricingConfigCount += 1
    }

    const scs =
      selection.scenarioIds && selection.scenarioIds.length > 0
        ? selection.scenarioIds
            .map((id) => scenariosDao.get(db, requireId(id, 'scenario')))
            .filter((s) => s.product_id === pid)
        : scenariosDao.list(db, pid)
    for (const sc of scs) {
      const overrides = parseJson<CostOverrides>(sc.overrides_json || '{}', 'scenario overrides')
      const input = productsDao.buildCostInput(pid, db, new Set(), overrides)
      const problems = validateProductCostInput(input, opts.customUnits)
      if (problems.length > 0) {
        throw new ExchangeError(`Cannot export scenario "${sc.name}": ${problems.join(' ')}`)
      }
      const result = computeProductCost(input, opts.customUnits)
      scenarios.push({
        productName: p.name,
        name: sc.name,
        baseSnapshotJson: sc.base_snapshot_json,
        overridesJson: sc.overrides_json,
        notes: sc.notes,
        computedCostPerUnit: result.totalUnitCost,
      })
      scenarioCount += 1
    }
  }

  const quoteIds =
    selection.quoteIds && selection.quoteIds.length > 0
      ? selection.quoteIds.map((id) => requireId(id, 'quote'))
      : quotesDao.list(db).map((q) => q.id)
  const quoteSnapshots: ExchangeExportQuote[] = quoteIds.map((qid) => {
    const qf = quotesDao.getFull(db, qid)
    const q = qf.quote
    return {
      reference: q.reference,
      customerName: q.customer_name,
      quoteDate: q.quote_date,
      expiresAt: q.expires_at,
      subtotal: q.subtotal,
      discountTotal: q.discount_total,
      taxTotal: q.tax_total,
      shippingTotal: q.shipping_total,
      total: q.total,
      currency,
      items: qf.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unit_price,
      })),
      frozenAssumptions: parseJson(q.snapshot_json || '{}', `frozen snapshot for quote "${q.reference}"`),
    }
  })

  const payload: OrderlyPricingExportPayload = {
    pricings,
    products,
    costStructures,
    pricingModels,
    scenarios,
    quoteSnapshots,
  }
  const envelope = buildEnvelope({
    contract: 'orderly.pricing-export',
    contractVersion: 1,
    payload: payload as unknown as Record<string, unknown>,
    producerVersion: opts.appVersion,
  })
  return {
    envelope,
    counts: {
      products: products.length,
      pricingConfigs: pricingConfigCount,
      scenarios: scenarioCount,
      quotes: quoteSnapshots.length,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

export function logExchange(
  db: DatabaseType,
  entry: {
    direction: 'import' | 'export'
    contract: string
    filename: string
    recordsCreated: number
    recordsUpdated: number
    recordsRejected: number
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO exchange_log
         (direction, contract, filename, records_created, records_updated, records_rejected, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.direction,
      entry.contract,
      entry.filename,
      entry.recordsCreated,
      entry.recordsUpdated,
      entry.recordsRejected,
      nowIso(),
    )
  return info.lastInsertRowid as number
}

export function listExchangeLog(db: DatabaseType, limit = 50): ExchangeLogEntry[] {
  const n = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50
  const rows = db
    .prepare(
      `SELECT id, direction, contract, filename, records_created, records_updated,
              records_rejected, created_at
       FROM exchange_log ORDER BY id DESC LIMIT ?`,
    )
    .all(n) as Array<{
    id: number
    direction: string
    contract: string
    filename: string
    records_created: number
    records_updated: number
    records_rejected: number
    created_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction as 'import' | 'export',
    contract: r.contract,
    filename: r.filename,
    recordsCreated: r.records_created,
    recordsUpdated: r.records_updated,
    recordsRejected: r.records_rejected,
    createdAt: r.created_at,
  }))
}
