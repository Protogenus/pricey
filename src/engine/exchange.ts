/**
 * Clever Signal Pricey — pricey-exchange-v1 file exchange schema.
 *
 * Pure TypeScript: no Electron, no fs, no database access. This module owns
 * the versioned envelope, the per-contract payload shapes, and every
 * validation rule. Structural failures (bad JSON shape, unknown schema,
 * unsupported versions, duplicate externalIds) throw ExchangeError and abort
 * the whole import — nothing is ever guessed at. Row-level problems
 * (incompatible units, bad field values) are collected as rejections so the
 * caller can show a preview and import the valid rows.
 *
 * The database layer (src/database/exchange.ts) matches validated rows
 * against existing records and applies them.
 */
import Decimal from 'decimal.js'
import { isValidNumber } from './money.js'
import { canConvert, getUnit, type CustomUnitDef } from './units.js'

/* ------------------------------------------------------------------ */
/* Contract registry                                                   */
/* ------------------------------------------------------------------ */

/** The exchange schema identifier every envelope must carry. */
export const EXCHANGE_SCHEMA = 'pricey-exchange'

/** The only schema major version this build reads or writes. */
export const EXCHANGE_SCHEMA_VERSION = 1

export type ExchangeContractName =
  | 'stockroom.material-costs'
  | 'elixer.formula-costs'
  | 'stagepoint.production-costs'
  | 'sublium.production-costs'
  | 'threadcount.production-costs'
  | 'orderly.pricing-export'

export type ExchangeDirection = 'inbound' | 'outbound'

export interface ExchangeContractDef {
  name: ExchangeContractName
  direction: ExchangeDirection
  /** Contract versions this build can read. */
  supportedVersions: number[]
}

export const EXCHANGE_CONTRACTS: ExchangeContractDef[] = [
  { name: 'stockroom.material-costs', direction: 'inbound', supportedVersions: [1] },
  { name: 'elixer.formula-costs', direction: 'inbound', supportedVersions: [1] },
  { name: 'stagepoint.production-costs', direction: 'inbound', supportedVersions: [1] },
  { name: 'sublium.production-costs', direction: 'inbound', supportedVersions: [1] },
  { name: 'threadcount.production-costs', direction: 'inbound', supportedVersions: [1] },
  { name: 'orderly.pricing-export', direction: 'outbound', supportedVersions: [1] },
]

export function getContractDef(name: string): ExchangeContractDef | null {
  return EXCHANGE_CONTRACTS.find((c) => c.name === name) ?? null
}

/* ------------------------------------------------------------------ */
/* Envelope + payload types                                            */
/* ------------------------------------------------------------------ */

export interface ExchangeEnvelope {
  schema: typeof EXCHANGE_SCHEMA
  schemaVersion: number
  exportedAt: string
  producer: string
  producerVersion: string
  contract: ExchangeContractName
  contractVersion: number
  payload: Record<string, unknown>
}

/** Build an outbound envelope. The caller supplies the app version. */
export function buildEnvelope(opts: {
  contract: ExchangeContractName
  contractVersion: number
  payload: Record<string, unknown>
  producerVersion: string
}): ExchangeEnvelope {
  return {
    schema: EXCHANGE_SCHEMA,
    schemaVersion: EXCHANGE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    producer: 'Pricey',
    producerVersion: opts.producerVersion,
    contract: opts.contract,
    contractVersion: opts.contractVersion,
    payload: opts.payload,
  }
}

/* ---------------- inbound payload shapes (validated) ---------------- */

export interface ValidStockroomMaterial {
  externalId?: string
  name: string
  unit: string
  unitDimension: string
  purchaseQty: string
  purchasePrice: string
  supplier: string
}

export interface ValidElixerIngredient {
  name: string
  qty: string
  unit: string
  costPerUnit: string
  costUnit: string
}

export interface ValidElixerFormula {
  externalId?: string
  name: string
  yieldQty: string
  yieldUnit: string
  ingredients: ValidElixerIngredient[]
}

export interface ValidStagepointRun {
  externalId?: string
  name: string
  quantity: string
  laborMinutes: string
  laborRatePerHour: string
  materialCostTotal: string
  notes: string
}

export interface ValidSubliumJob {
  externalId?: string
  name: string
  blankCostPerUnit: string
  inkCostPerUnit: string
  pressMinutesPerUnit: string
  laborRatePerHour: string
}

export interface ValidThreadcountDesign {
  externalId?: string
  name: string
  threadCostPerUnit: string
  stabilizerCostPerUnit: string
  productionMinutesPerUnit: string
  machineRatePerHour: string
}

/* ---------------- outbound (orderly.pricing-export) payload shapes ---------------- */

export interface OrderlyPricingRow {
  productName: string
  sku: string
  channel: string
  unitPrice: string
  currency: string
  snapshotId: number
}

export interface ExchangeExportMaterial {
  name: string
  unit: string
  unitDimension: string
  purchaseQty: string
  purchasePrice: string
  lineQuantity: string
  lineUnit: string
  lineWastePct: string
}

export interface ExchangeExportLabor {
  taskName: string
  mode: string
  rate: string
  quantity: string
}

export interface ExchangeExportOverhead {
  name: string
  method: string
  value: string
}

export interface ExchangeExportOtherCost {
  name: string
  amountPerUnit: string
}

export interface ExchangeExportProduct {
  name: string
  sku: string
  category: string
  unitOfSale: string
  batchSize: number
  wastePct: string
  defectPct: string
  costPerUnit: string
}

export interface ExchangeExportCostStructure {
  productName: string
  materials: ExchangeExportMaterial[]
  labor: ExchangeExportLabor[]
  overhead: ExchangeExportOverhead[]
  otherCosts: ExchangeExportOtherCost[]
}

export interface ExchangeExportPricingModel {
  productName: string
  name: string
  channel: string
  method: string
  params: Record<string, unknown>
}

export interface ExchangeExportScenario {
  productName: string
  name: string
  baseSnapshotJson: string
  overridesJson: string
  notes: string
  computedCostPerUnit: string
}

export interface ExchangeExportQuoteItem {
  description: string
  quantity: string
  unitPrice: string
}

export interface ExchangeExportQuote {
  reference: string
  customerName: string
  quoteDate: string
  expiresAt: string
  subtotal: string
  discountTotal: string
  taxTotal: string
  shippingTotal: string
  total: string
  currency: string
  items: ExchangeExportQuoteItem[]
  /** The frozen assumption snapshot — carried verbatim, never recomputed. */
  frozenAssumptions: unknown
}

export interface OrderlyPricingExportPayload {
  /** The documented v1 contract section — Orderly reads this. */
  pricings: OrderlyPricingRow[]
  /** Additive Pricey-owned sections; foreign consumers must ignore unknown sections. */
  products: ExchangeExportProduct[]
  costStructures: ExchangeExportCostStructure[]
  pricingModels: ExchangeExportPricingModel[]
  scenarios: ExchangeExportScenario[]
  quoteSnapshots: ExchangeExportQuote[]
}

/* ------------------------------------------------------------------ */
/* Preview / report / log wire types                                   */
/* ------------------------------------------------------------------ */

export type ExchangeRowKind = 'material' | 'product' | 'pricingConfig' | 'scenario' | 'quote'

export interface ExchangeRowPreview {
  kind: ExchangeRowKind
  externalId?: string
  name: string
  action: 'create' | 'update'
  detail: string
  changes: string[]
}

export interface ExchangeRowRejected {
  kind: ExchangeRowKind
  externalId?: string
  name: string
  reasons: string[]
}

export interface ExchangePreview {
  contract: ExchangeContractName
  contractVersion: number
  producer: string
  producerVersion: string
  exportedAt: string
  totals: { create: number; update: number; rejected: number }
  rows: ExchangeRowPreview[]
  rejected: ExchangeRowRejected[]
}

export interface ExchangeReport {
  contract: ExchangeContractName
  created: number
  updated: number
  rejected: number
  applied: ExchangeRowPreview[]
  rejectedRows: ExchangeRowRejected[]
  logId: number
}

export interface ExchangeLogEntry {
  id: number
  direction: 'import' | 'export'
  contract: string
  filename: string
  recordsCreated: number
  recordsUpdated: number
  recordsRejected: number
  createdAt: string
}

/** Explicit record ids to export; empty/undefined selects everything. */
export interface ExchangeSelection {
  productIds?: number[]
  pricingConfigIds?: number[]
  scenarioIds?: number[]
  quoteIds?: number[]
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Structural validation failure: the whole file is rejected and nothing is
 * written. Every problem names the offending field.
 */
export class ExchangeError extends Error {
  readonly problems: string[]
  constructor(problems: string[] | string) {
    const list = Array.isArray(problems) ? problems : [problems]
    super(list.join(' '))
    this.name = 'ExchangeError'
    this.problems = list
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ExchangeValidationCtx {
  customUnits: CustomUnitDef[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function reqString(obj: Record<string, unknown>, field: string, path: string): string {
  const v = obj[field]
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new ExchangeError(`${path}: "${field}" is required and must be a non-empty string.`)
  return s
}

function optString(obj: Record<string, unknown>, field: string): string {
  const v = obj[field]
  if (v === undefined || v === null) return ''
  return String(v)
}

function optExternalId(obj: Record<string, unknown>, path: string): string | undefined {
  const v = obj['externalId']
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string' || !v.trim()) {
    throw new ExchangeError(`${path}: "externalId" must be a non-empty string when present.`)
  }
  return v.trim()
}

/** Normalize a decimal field to its exact trimmed string form. Null = row-level problem recorded. */
function checkDecimal(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  problems: string[],
  opts: { min?: string; allowZero?: boolean; integer?: boolean } = {},
): string | null {
  const raw = obj[field]
  const label = `${path}: "${field}"`
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    problems.push(`${label} is required.`)
    return null
  }
  const s = typeof raw === 'string' ? raw.trim() : String(raw)
  if (!isValidNumber(s)) {
    problems.push(`${label} must be a number. Got "${s}".`)
    return null
  }
  // Reject exponential / non-plain forms that would not survive a TEXT round-trip.
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) {
    problems.push(`${label} must be a plain decimal number. Got "${s}".`)
    return null
  }
  const d = new Decimal(s)
  if (opts.min !== undefined) {
    const m = new Decimal(opts.min)
    if (opts.allowZero ? d.lt(m) : d.lte(m)) {
      problems.push(
        `${label} must be ${opts.allowZero ? 'at least' : 'greater than'} ${opts.min}. Got "${s}".`,
      )
      return null
    }
  }
  if (opts.integer && !d.isInteger()) {
    problems.push(`${label} must be a whole number. Got "${s}".`)
    return null
  }
  return s
}

/** Validate a unit symbol against the registry; null = problem recorded. */
function checkUnit(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  ctx: ExchangeValidationCtx,
  problems: string[],
): string | null {
  const raw = obj[field]
  const label = `${path}: "${field}"`
  if (typeof raw !== 'string' || !raw.trim()) {
    problems.push(`${label} is required and must be a unit symbol (e.g. "g", "kg", "piece").`)
    return null
  }
  const symbol = raw.trim()
  try {
    getUnit(symbol, ctx.customUnits)
    return symbol
  } catch {
    problems.push(
      `${label}: unknown unit "${symbol}". Add it as a custom unit in Pricey Settings before importing.`,
    )
    return null
  }
}

/** Resolve the true dimension of a registry unit (custom units resolve to their declared dimension). */
export function unitDimensionOf(symbol: string, ctx: ExchangeValidationCtx): string {
  const def = getUnit(symbol, ctx.customUnits)
  if (def.dimension !== 'custom') return def.dimension
  const custom = ctx.customUnits.find((u) => u.symbol === def.symbol)
  if (!custom) throw new ExchangeError(`Custom unit "${symbol}" has no registered dimension.`)
  return custom.dimension
}

/** Cross-check a declared unitDimension against the registry; null = problem recorded. */
function checkUnitDimension(
  declared: unknown,
  unitSymbol: string,
  path: string,
  ctx: ExchangeValidationCtx,
  problems: string[],
): string | null {
  const actual = unitDimensionOf(unitSymbol, ctx)
  if (declared === undefined || declared === null || declared === '') return actual
  if (declared !== actual) {
    problems.push(
      `${path}: declared unit dimension "${declared}" does not match unit "${unitSymbol}" (${actual}).`,
    )
    return null
  }
  return actual
}

function checkDuplicateExternalIds(
  rows: Array<{ externalId?: string }>,
  path: string,
): void {
  const seen = new Map<string, number>()
  rows.forEach((r, i) => {
    if (!r.externalId) return
    const prev = seen.get(r.externalId)
    if (prev !== undefined) {
      throw new ExchangeError(
        `${path}[${i}].externalId: duplicate externalId "${r.externalId}" (first seen at row ${prev}). ` +
          `Each row's externalId must be unique within the file.`,
      )
    }
    seen.set(r.externalId, i)
  })
}

export interface RowRejection {
  index: number
  externalId?: string
  name: string
  reasons: string[]
}

/* ---------------- stockroom.material-costs ---------------- */

export interface ValidatedStockroom {
  materials: ValidStockroomMaterial[]
  rejected: RowRejection[]
}

function validateStockroomPayload(
  payload: Record<string, unknown>,
  ctx: ExchangeValidationCtx,
): ValidatedStockroom {
  const raw = payload['materials']
  if (!Array.isArray(raw)) throw new ExchangeError('payload: "materials" must be an array.')
  const materials: ValidStockroomMaterial[] = []
  const rejected: RowRejection[] = []
  const ids: Array<{ externalId?: string }> = []
  raw.forEach((entry, i) => {
    const path = `payload.materials[${i}]`
    if (!isRecord(entry)) {
      rejected.push({ index: i, name: `#${i}`, reasons: [`${path}: must be an object.`] })
      return
    }
    const problems: string[] = []
    let externalId: string | undefined
    try {
      externalId = optExternalId(entry, path)
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e))
    }
    ids.push({ externalId })
    const name = typeof entry['name'] === 'string' && entry['name'].trim() ? entry['name'].trim() : null
    if (!name) problems.push(`${path}: "name" is required.`)
    const unit = checkUnit(entry, 'unit', path, ctx, problems)
    let unitDimension: string | null = null
    if (unit) unitDimension = checkUnitDimension(entry['unitDimension'], unit, path, ctx, problems)
    const purchaseQty = checkDecimal(entry, 'purchaseQty', path, problems, { min: '0' })
    const purchasePrice = checkDecimal(entry, 'purchasePrice', path, problems, {
      min: '0',
      allowZero: true,
    })
    const supplier = optString(entry, 'supplier')
    if (problems.length > 0) {
      rejected.push({ index: i, externalId, name: name ?? `#${i}`, reasons: problems })
      return
    }
    materials.push({
      externalId,
      name: name as string,
      unit: unit as string,
      unitDimension: unitDimension as string,
      purchaseQty: purchaseQty as string,
      purchasePrice: purchasePrice as string,
      supplier,
    })
  })
  checkDuplicateExternalIds(ids, 'payload.materials')
  return { materials, rejected }
}

/* ---------------- elixer.formula-costs ---------------- */

export interface ValidatedElixer {
  formula: ValidElixerFormula
  rejected: RowRejection[]
}

function validateElixerPayload(
  payload: Record<string, unknown>,
  ctx: ExchangeValidationCtx,
): ValidatedElixer {
  const raw = payload['formula']
  if (!isRecord(raw)) throw new ExchangeError('payload: "formula" must be an object.')
  const path = 'payload.formula'
  const structural: string[] = []
  let externalId: string | undefined
  try {
    externalId = optExternalId(raw, path)
  } catch (e) {
    structural.push(e instanceof Error ? e.message : String(e))
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim() : null
  if (!name) structural.push(`${path}: "name" is required.`)
  const problems: string[] = []
  const yieldQty = checkDecimal(raw, 'yieldQty', path, problems, { min: '0' })
  const yieldUnit = checkUnit(raw, 'yieldUnit', path, ctx, problems)
  if (structural.length > 0) throw new ExchangeError(structural)
  const rawIngredients = raw['ingredients']
  if (!Array.isArray(rawIngredients) || rawIngredients.length === 0) {
    throw new ExchangeError(`${path}: "ingredients" must be a non-empty array.`)
  }
  const ingredients: ValidElixerIngredient[] = []
  const rejected: RowRejection[] = []
  rawIngredients.forEach((entry, i) => {
    const ipath = `${path}.ingredients[${i}]`
    if (!isRecord(entry)) {
      rejected.push({ index: i, name: `#${i}`, reasons: [`${ipath}: must be an object.`] })
      return
    }
    const iproblems: string[] = []
    const iname =
      typeof entry['name'] === 'string' && entry['name'].trim() ? entry['name'].trim() : null
    if (!iname) iproblems.push(`${ipath}: "name" is required.`)
    const qty = checkDecimal(entry, 'qty', ipath, iproblems, { min: '0' })
    const unit = checkUnit(entry, 'unit', ipath, ctx, iproblems)
    const costPerUnit = checkDecimal(entry, 'costPerUnit', ipath, iproblems, {
      min: '0',
      allowZero: true,
    })
    const costUnit = checkUnit(entry, 'costUnit', ipath, ctx, iproblems)
    if (unit && costUnit && !canConvert(unit, costUnit, ctx.customUnits)) {
      iproblems.push(
        `${ipath}: cannot convert usage unit "${unit}" to cost unit "${costUnit}" for ingredient "${iname ?? `#${i}`}" — incompatible units.`,
      )
    }
    if (iproblems.length > 0) {
      rejected.push({ index: i, name: iname ?? `#${i}`, reasons: iproblems })
      return
    }
    ingredients.push({
      name: iname as string,
      qty: qty as string,
      unit: unit as string,
      costPerUnit: costPerUnit as string,
      costUnit: costUnit as string,
    })
  })
  if (problems.length > 0) throw new ExchangeError(problems)
  return {
    formula: {
      externalId,
      name: name as string,
      yieldQty: yieldQty as string,
      yieldUnit: yieldUnit as string,
      ingredients,
    },
    rejected,
  }
}

/* ---------------- stagepoint.production-costs ---------------- */

export interface ValidatedStagepoint {
  run: ValidStagepointRun
  rejected: RowRejection[]
}

function validateStagepointPayload(
  payload: Record<string, unknown>,
  _ctx: ExchangeValidationCtx,
): ValidatedStagepoint {
  const raw = payload['run']
  if (!isRecord(raw)) throw new ExchangeError('payload: "run" must be an object.')
  const path = 'payload.run'
  const structural: string[] = []
  let externalId: string | undefined
  try {
    externalId = optExternalId(raw, path)
  } catch (e) {
    structural.push(e instanceof Error ? e.message : String(e))
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim() : null
  if (!name) structural.push(`${path}: "name" is required.`)
  if (structural.length > 0) throw new ExchangeError(structural)
  const problems: string[] = []
  const quantity = checkDecimal(raw, 'quantity', path, problems, { min: '0' })
  const laborMinutes = checkDecimal(raw, 'laborMinutes', path, problems, { min: '0', allowZero: true })
  const laborRatePerHour = checkDecimal(raw, 'laborRatePerHour', path, problems, {
    min: '0',
    allowZero: true,
  })
  const materialCostTotal = checkDecimal(raw, 'materialCostTotal', path, problems, {
    min: '0',
    allowZero: true,
  })
  const notes = optString(raw, 'notes')
  if (problems.length > 0) {
    return {
      run: null as unknown as ValidStagepointRun,
      rejected: [{ index: 0, externalId, name: name as string, reasons: problems }],
    }
  }
  return {
    run: {
      externalId,
      name: name as string,
      quantity: quantity as string,
      laborMinutes: laborMinutes as string,
      laborRatePerHour: laborRatePerHour as string,
      materialCostTotal: materialCostTotal as string,
      notes,
    },
    rejected: [],
  }
}

/* ---------------- sublium.production-costs ---------------- */

export interface ValidatedSublium {
  job: ValidSubliumJob
  rejected: RowRejection[]
}

function validateSubliumPayload(
  payload: Record<string, unknown>,
  _ctx: ExchangeValidationCtx,
): ValidatedSublium {
  const raw = payload['job']
  if (!isRecord(raw)) throw new ExchangeError('payload: "job" must be an object.')
  const path = 'payload.job'
  const structural: string[] = []
  let externalId: string | undefined
  try {
    externalId = optExternalId(raw, path)
  } catch (e) {
    structural.push(e instanceof Error ? e.message : String(e))
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim() : null
  if (!name) structural.push(`${path}: "name" is required.`)
  if (structural.length > 0) throw new ExchangeError(structural)
  const problems: string[] = []
  const num = (field: string) =>
    checkDecimal(raw, field, path, problems, { min: '0', allowZero: true })
  const blankCostPerUnit = num('blankCostPerUnit')
  const inkCostPerUnit = num('inkCostPerUnit')
  const pressMinutesPerUnit = num('pressMinutesPerUnit')
  const laborRatePerHour = num('laborRatePerHour')
  if (problems.length > 0) {
    return {
      job: null as unknown as ValidSubliumJob,
      rejected: [{ index: 0, externalId, name: name as string, reasons: problems }],
    }
  }
  return {
    job: {
      externalId,
      name: name as string,
      blankCostPerUnit: blankCostPerUnit as string,
      inkCostPerUnit: inkCostPerUnit as string,
      pressMinutesPerUnit: pressMinutesPerUnit as string,
      laborRatePerHour: laborRatePerHour as string,
    },
    rejected: [],
  }
}

/* ---------------- threadcount.production-costs ---------------- */

export interface ValidatedThreadcount {
  design: ValidThreadcountDesign
  rejected: RowRejection[]
}

function validateThreadcountPayload(
  payload: Record<string, unknown>,
  _ctx: ExchangeValidationCtx,
): ValidatedThreadcount {
  const raw = payload['design']
  if (!isRecord(raw)) throw new ExchangeError('payload: "design" must be an object.')
  const path = 'payload.design'
  const structural: string[] = []
  let externalId: string | undefined
  try {
    externalId = optExternalId(raw, path)
  } catch (e) {
    structural.push(e instanceof Error ? e.message : String(e))
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim() : null
  if (!name) structural.push(`${path}: "name" is required.`)
  if (structural.length > 0) throw new ExchangeError(structural)
  const problems: string[] = []
  const num = (field: string) =>
    checkDecimal(raw, field, path, problems, { min: '0', allowZero: true })
  const threadCostPerUnit = num('threadCostPerUnit')
  const stabilizerCostPerUnit = num('stabilizerCostPerUnit')
  const productionMinutesPerUnit = num('productionMinutesPerUnit')
  const machineRatePerHour = num('machineRatePerHour')
  if (problems.length > 0) {
    return {
      design: null as unknown as ValidThreadcountDesign,
      rejected: [{ index: 0, externalId, name: name as string, reasons: problems }],
    }
  }
  return {
    design: {
      externalId,
      name: name as string,
      threadCostPerUnit: threadCostPerUnit as string,
      stabilizerCostPerUnit: stabilizerCostPerUnit as string,
      productionMinutesPerUnit: productionMinutesPerUnit as string,
      machineRatePerHour: machineRatePerHour as string,
    },
    rejected: [],
  }
}

/* ---------------- orderly.pricing-export (Pricey transfer) ---------------- */

export interface ValidatedOrderly {
  transfer: OrderlyPricingExportPayload
  rejected: RowRejection[]
}

/**
 * Pricey imports its own exports (machine-to-machine transfer). The envelope
 * producer must be Pricey itself — never import another app's pricing file
 * as if it were Pricey data.
 */
function validateOrderlyPayload(
  envelope: ExchangeEnvelope,
  _ctx: ExchangeValidationCtx,
): ValidatedOrderly {
  if (envelope.producer !== 'Pricey') {
    throw new ExchangeError(
      `contract "orderly.pricing-export": this file was produced by "${envelope.producer}" — ` +
        `Pricey only imports its own pricing exports (producer "Pricey"). The file was not imported.`,
    )
  }
  const payload = envelope.payload
  const problems: string[] = []
  const sections: Array<[string, string]> = [
    ['pricings', 'array'],
    ['products', 'array'],
    ['costStructures', 'array'],
    ['pricingModels', 'array'],
    ['scenarios', 'array'],
    ['quoteSnapshots', 'array'],
  ]
  for (const [key] of sections) {
    const v = payload[key]
    if (v !== undefined && !Array.isArray(v)) problems.push(`payload: "${key}" must be an array.`)
  }
  if (problems.length > 0) throw new ExchangeError(problems)
  const transfer = payload as unknown as OrderlyPricingExportPayload
  // Structural row checks: every section row must be an object with the key fields.
  const rejected: RowRejection[] = []
  const checkRows = (
    key: 'products' | 'costStructures' | 'pricingModels' | 'scenarios' | 'quoteSnapshots',
    label: (row: Record<string, unknown>, i: number) => string | null,
  ) => {
    const rows = (transfer[key] ?? []) as unknown[]
    const kept: unknown[] = []
    rows.forEach((r, i) => {
      if (!isRecord(r)) {
        rejected.push({ index: i, name: `${key}[${i}]`, reasons: [`payload.${key}[${i}]: must be an object.`] })
        return
      }
      const name = label(r, i)
      if (name === null) {
        rejected.push({
          index: i,
          name: `${key}[${i}]`,
          reasons: [`payload.${key}[${i}]: missing identifying field (name/productName/reference).`],
        })
        return
      }
      kept.push(r)
    })
    ;(transfer as unknown as Record<string, unknown>)[key] = kept
  }
  checkRows('products', (r) => (typeof r['name'] === 'string' && r['name'].trim() ? r['name'].trim() : null))
  checkRows('costStructures', (r) =>
    typeof r['productName'] === 'string' && r['productName'].trim() ? r['productName'].trim() : null,
  )
  checkRows('pricingModels', (r) =>
    typeof r['productName'] === 'string' && r['productName'].trim() ? r['productName'].trim() : null,
  )
  checkRows('scenarios', (r) =>
    typeof r['productName'] === 'string' && r['productName'].trim() ? r['productName'].trim() : null,
  )
  checkRows('quoteSnapshots', (r) =>
    typeof r['reference'] === 'string' && r['reference'].trim() ? r['reference'].trim() : null,
  )
  return { transfer, rejected }
}

export type ValidatedPayload =
  | { contract: 'stockroom.material-costs'; data: ValidatedStockroom }
  | { contract: 'elixer.formula-costs'; data: ValidatedElixer }
  | { contract: 'stagepoint.production-costs'; data: ValidatedStagepoint }
  | { contract: 'sublium.production-costs'; data: ValidatedSublium }
  | { contract: 'threadcount.production-costs'; data: ValidatedThreadcount }
  | { contract: 'orderly.pricing-export'; data: ValidatedOrderly }

/* ---------------- envelope ---------------- */

/** Parse + validate the envelope. Throws ExchangeError on any structural problem. */
export function validateEnvelope(raw: unknown, ctx: ExchangeValidationCtx): ExchangeEnvelope {
  void ctx
  if (!isRecord(raw)) {
    throw new ExchangeError(
      'The file is not a Pricey exchange file: expected a JSON object at the top level.',
    )
  }
  const problems: string[] = []
  if (raw['schema'] !== EXCHANGE_SCHEMA) {
    throw new ExchangeError(
      `Not a Pricey exchange file: schema is ${JSON.stringify(raw['schema'])}, expected "${EXCHANGE_SCHEMA}".`,
    )
  }
  const sv = raw['schemaVersion']
  if (typeof sv !== 'number' || !Number.isFinite(sv)) {
    throw new ExchangeError('envelope: "schemaVersion" must be a number.')
  }
  if (Math.floor(sv) !== EXCHANGE_SCHEMA_VERSION) {
    throw new ExchangeError(
      `Unsupported exchange schema version ${sv}: this build of Pricey reads pricey-exchange v1 files only. ` +
        `The file was not imported — ask the exporting app for a v1 file.`,
    )
  }
  const contract = raw['contract']
  const def = typeof contract === 'string' ? getContractDef(contract) : null
  if (!def) {
    const known = EXCHANGE_CONTRACTS.map((c) => c.name).join(', ')
    throw new ExchangeError(
      `Unknown contract ${JSON.stringify(contract)}. Pricey knows: ${known}. The file was not imported.`,
    )
  }
  const cv = raw['contractVersion']
  if (typeof cv !== 'number' || !Number.isInteger(cv)) {
    throw new ExchangeError(`envelope: "contractVersion" must be a whole number.`)
  }
  if (!def.supportedVersions.includes(cv)) {
    throw new ExchangeError(
      `Contract "${def.name}" version ${cv} is not supported by this build of Pricey ` +
        `(supports v${def.supportedVersions.join(', v')}). The file was not imported — never guessed at.`,
    )
  }
  try {
    reqString(raw, 'producer', 'envelope')
    reqString(raw, 'producerVersion', 'envelope')
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e))
  }
  const exportedAt = raw['exportedAt']
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) {
    problems.push('envelope: "exportedAt" must be an ISO date string.')
  }
  if (!isRecord(raw['payload'])) {
    problems.push('envelope: "payload" must be an object.')
  }
  if (problems.length > 0) throw new ExchangeError(problems)
  return raw as unknown as ExchangeEnvelope
}

/** Validate the payload for the envelope's contract. Throws on structural failure. */
export function validatePayload(
  envelope: ExchangeEnvelope,
  ctx: ExchangeValidationCtx,
): ValidatedPayload {
  switch (envelope.contract) {
    case 'stockroom.material-costs':
      return { contract: envelope.contract, data: validateStockroomPayload(envelope.payload, ctx) }
    case 'elixer.formula-costs':
      return { contract: envelope.contract, data: validateElixerPayload(envelope.payload, ctx) }
    case 'stagepoint.production-costs':
      return { contract: envelope.contract, data: validateStagepointPayload(envelope.payload, ctx) }
    case 'sublium.production-costs':
      return { contract: envelope.contract, data: validateSubliumPayload(envelope.payload, ctx) }
    case 'threadcount.production-costs':
      return { contract: envelope.contract, data: validateThreadcountPayload(envelope.payload, ctx) }
    case 'orderly.pricing-export':
      return { contract: envelope.contract, data: validateOrderlyPayload(envelope, ctx) }
  }
}

/** Parse a file's text into a validated envelope + payload. Throws ExchangeError. */
export function parseExchangeFile(
  text: string,
  ctx: ExchangeValidationCtx,
): { envelope: ExchangeEnvelope; validated: ValidatedPayload } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ExchangeError(
      'The file is not valid JSON. Choose a .pricey-exchange.json file exported from a Clever Signal app.',
    )
  }
  const envelope = validateEnvelope(raw, ctx)
  const validated = validatePayload(envelope, ctx)
  return { envelope, validated }
}
