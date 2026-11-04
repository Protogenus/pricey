/**
 * Clever Signal Pricey — universal cost engine.
 *
 * Models a product's full cost structure and rolls it up to per-unit and
 * batch costs. Every line carries its formula and substituted inputs so the
 * calculation explainer can show exactly how each number was produced.
 *
 * Waste model (documented in docs/FORMULAS.md):
 *  - Line-level waste_pct (0..1): extra material allowance for that usage.
 *    required = quantity / (1 - waste_pct). The waste portion is reported
 *    separately as waste cost, never folded invisibly into material cost.
 *  - Product-level waste_pct: one multiplier applied ONCE to the whole
 *    material subtotal (materials + packaging + services). It does not touch
 *    labor or overhead, and it is never applied per-line (no double count).
 *  - defect_pct: fraction of produced units that are unusable. Usable output
 *    = batchSize * (1 - defect_pct); costPerUsableUnit spreads the full batch
 *    cost across usable units only.
 *
 * Nested components: a product may contain other products (subassemblies).
 * The engine recurses with an ancestor set — a cycle raises CostEngineError
 * instead of recursing forever. Shared/reusable components are supported:
 * the same component product can appear in many parents.
 */
import Decimal from 'decimal.js'
import { dec, ZERO, ONE } from './money.js'
import { convert, type CustomUnitDef, type UnitDimension } from './units.js'

export class CostEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostEngineError'
  }
}

export type MaterialCategory = 'material' | 'packaging' | 'service'
export type LaborMode = 'hourly' | 'per_minute' | 'per_unit' | 'fixed'
export type OverheadMethod = 'per_unit' | 'per_batch' | 'pct_of_direct' | 'per_hour' | 'monthly_share'

export interface MaterialCostInput {
  id: number
  name: string
  category: MaterialCategory
  /** Unit the costPerUnit is denominated in. */
  unit: string
  dimension: UnitDimension
  costPerUnit: Decimal.Value
}

export interface MaterialLineInput {
  material: MaterialCostInput
  /** Quantity used per unit of product, denominated in `unit`. */
  quantity: Decimal.Value
  unit: string
  /** 0..1 extra allowance for this usage. */
  wastePct: Decimal.Value
}

export interface LaborLineInput {
  taskName: string
  mode: LaborMode
  /** hourly rate / per-minute rate / per-unit rate / fixed charge. */
  rate: Decimal.Value
  /** minutes for hourly|per_minute, units for per_unit, ignored for fixed. */
  quantity: Decimal.Value
}

export interface OverheadLineInput {
  name: string
  method: OverheadMethod
  /**
   * Meaning by method:
   *  per_unit      — currency amount per unit
   *  per_batch     — currency amount per batch (divided by batchSize)
   *  pct_of_direct — fraction 0..1 of direct cost per unit
   *  per_hour      — labor-hours per unit; requires hourlyRate
   *  monthly_share — fraction 0..1 of monthlyAmount; requires monthlyAmount + monthlyUnits
   */
  value: Decimal.Value
  hourlyRate?: Decimal.Value
  monthlyAmount?: Decimal.Value
  monthlyUnits?: Decimal.Value
}

export interface OtherCostInput {
  name: string
  amountPerUnit: Decimal.Value
}

export interface ComponentInput {
  product: ProductCostInput
  /** Quantity of the component (in component units) per unit of parent. */
  quantity: Decimal.Value
}

export interface ProductCostInput {
  /** Stable id used for cycle detection; use a temp negative id for unsaved products. */
  id: number
  name: string
  batchSize: Decimal.Value
  materials: MaterialLineInput[]
  labor: LaborLineInput[]
  overhead: OverheadLineInput[]
  other: OtherCostInput[]
  components: ComponentInput[]
  /** 0..1 — applied once to the whole material subtotal. */
  wastePct: Decimal.Value
  /** 0..1 — fraction of produced units that are defective. */
  defectPct: Decimal.Value
}

export interface TraceLine {
  label: string
  category: 'material' | 'packaging' | 'service' | 'labor' | 'overhead' | 'other' | 'component' | 'waste'
  /** Full-precision decimal string. */
  amount: string
  formula: string
  inputs: Record<string, string>
}

export interface ProductCostResult {
  materialCost: string
  packagingCost: string
  serviceCost: string
  laborCost: string
  otherDirectCost: string
  componentCost: string
  /** Materials + packaging + services + labor + other + components (before overhead). */
  directCost: string
  overheadCost: string
  /** Waste allowance cost, reported separately (line-level + product-level). */
  wasteCost: string
  totalUnitCost: string
  totalBatchCost: string
  usableUnits: string
  costPerUsableUnit: string
  lines: TraceLine[]
  warnings: string[]
  assumptions: string[]
}

function reqFraction(v: Decimal.Value, what: string): Decimal {
  const d = dec(v)
  if (d.isNegative() || d.gte(ONE)) {
    throw new CostEngineError(`${what} must be in the range [0, 1). Got ${d.toString()}.`)
  }
  return d
}

function reqNonNegative(v: Decimal.Value, what: string): Decimal {
  const d = dec(v)
  if (d.isNegative() || !d.isFinite()) {
    throw new CostEngineError(`${what} must be a finite number >= 0. Got ${String(v)}.`)
  }
  return d
}

/**
 * Compute the full cost of one product. Pure function — no I/O.
 * All amounts in the result are full-precision decimal strings.
 */
export function computeProductCost(
  input: ProductCostInput,
  customUnits: CustomUnitDef[] = [],
  ancestors: ReadonlySet<number> = new Set(),
): ProductCostResult {
  if (ancestors.has(input.id)) {
    throw new CostEngineError(
      `Circular component reference: "${input.name}" contains itself through a component chain.`,
    )
  }
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(input.id)

  const batchSize = reqNonNegative(input.batchSize, 'Batch size')
  if (batchSize.isZero()) {
    throw new CostEngineError('Batch size must be greater than zero.')
  }
  const productWaste = reqFraction(input.wastePct, 'Product waste percentage')
  const defectPct = reqFraction(input.defectPct, 'Defective production percentage')

  const lines: TraceLine[] = []
  const warnings: string[] = []
  const assumptions: string[] = []

  // ---- Materials (with line-level waste folded into required quantity) ----
  let materialBase = ZERO
  let packagingBase = ZERO
  let serviceBase = ZERO
  let lineWasteTotal = ZERO
  let wasteCost = ZERO

  for (const line of input.materials) {
    const qty = reqNonNegative(line.quantity, `Material quantity for "${line.material.name}"`)
    const lineWaste = reqFraction(line.wastePct, `Waste percentage for "${line.material.name}"`)
    const qtyInMatUnit = convert(qty, line.unit, line.material.unit, customUnits)
    const requiredQty = qtyInMatUnit.div(ONE.minus(lineWaste))
    const unitCost = reqNonNegative(line.material.costPerUnit, `Cost per unit for "${line.material.name}"`)
    const baseCost = qtyInMatUnit.times(unitCost)
    const lineCost = requiredQty.times(unitCost)
    const wastePart = lineCost.minus(baseCost)
    lineWasteTotal = lineWasteTotal.plus(wastePart)
    wasteCost = wasteCost.plus(wastePart)
    if (line.material.category === 'packaging') packagingBase = packagingBase.plus(baseCost)
    else if (line.material.category === 'service') serviceBase = serviceBase.plus(baseCost)
    else materialBase = materialBase.plus(baseCost)

    lines.push({
      label: `${line.material.name} — ${qty.toString()} ${line.unit}/unit`,
      category: line.material.category,
      amount: lineCost.toString(),
      formula: 'required = qty ÷ (1 − waste) ; cost = required × costPerUnit',
      inputs: {
        quantity: `${qty.toString()} ${line.unit}`,
        quantityInCostUnit: `${qtyInMatUnit.toString()} ${line.material.unit}`,
        wastePct: lineWaste.toString(),
        requiredQuantity: `${requiredQty.toString()} ${line.material.unit}`,
        costPerUnit: unitCost.toString(),
        wastePortion: wastePart.toString(),
      },
    })
  }

  // ---- Product-level waste: one multiplier on the whole material subtotal ----
  const materialSubtotal = materialBase.plus(packagingBase).plus(serviceBase)
  const productWasteCost = materialSubtotal.times(productWaste).div(ONE.minus(productWaste))
  wasteCost = wasteCost.plus(productWasteCost)
  // Line-level waste is reported separately AND included in the total:
  // it is real material you must purchase.
  const materialTotal = materialSubtotal.plus(lineWasteTotal).plus(productWasteCost)
  if (productWaste.gt(ZERO)) {
    lines.push({
      label: `Product waste allowance (${productWaste.times(100).toString()}%)`,
      category: 'waste',
      amount: productWasteCost.toString(),
      formula: 'wasteCost = materialSubtotal × waste ÷ (1 − waste)',
      inputs: {
        materialSubtotal: materialSubtotal.toString(),
        wastePct: productWaste.toString(),
      },
    })
    assumptions.push(
      `Product-level waste of ${productWaste.times(100).toString()}% was applied once to the whole material subtotal, not per line.`,
    )
  }

  // ---- Labor ----
  let laborCost = ZERO
  for (const line of input.labor) {
    const rate = reqNonNegative(line.rate, `Labor rate for "${line.taskName || 'labor'}"`)
    const qty = reqNonNegative(line.quantity, `Labor quantity for "${line.taskName || 'labor'}"`)
    let cost: Decimal
    let formula: string
    switch (line.mode) {
      case 'hourly':
        cost = rate.times(qty).div(60)
        formula = 'cost = hourlyRate × minutes ÷ 60'
        break
      case 'per_minute':
        cost = rate.times(qty)
        formula = 'cost = perMinuteRate × minutes'
        break
      case 'per_unit':
        cost = rate.times(qty)
        formula = 'cost = perUnitRate × units'
        break
      case 'fixed':
        cost = rate
        formula = 'cost = fixedCharge'
        break
      default:
        throw new CostEngineError(`Unknown labor mode "${(line as { mode: string }).mode}".`)
    }
    laborCost = laborCost.plus(cost)
    lines.push({
      label: `Labor — ${line.taskName || line.mode} (${line.mode})`,
      category: 'labor',
      amount: cost.toString(),
      formula,
      inputs: { rate: rate.toString(), quantity: qty.toString(), mode: line.mode },
    })
  }

  // ---- Other direct costs ----
  let otherDirect = ZERO
  for (const oc of input.other) {
    const amt = reqNonNegative(oc.amountPerUnit, `Other cost "${oc.name}"`)
    otherDirect = otherDirect.plus(amt)
    lines.push({
      label: `Other — ${oc.name}`,
      category: 'other',
      amount: amt.toString(),
      formula: 'cost = amountPerUnit',
      inputs: { amountPerUnit: amt.toString() },
    })
  }

  // ---- Nested components (recursive roll-up) ----
  let componentCost = ZERO
  for (const comp of input.components) {
    const qty = reqNonNegative(comp.quantity, `Component quantity for "${comp.product.name}"`)
    const sub = computeProductCost(comp.product, customUnits, nextAncestors)
    const compUnitCost = dec(sub.totalUnitCost)
    const lineCost = compUnitCost.times(qty)
    componentCost = componentCost.plus(lineCost)
    lines.push({
      label: `Component — ${comp.product.name} × ${qty.toString()}`,
      category: 'component',
      amount: lineCost.toString(),
      formula: 'cost = componentTotalUnitCost × quantity',
      inputs: {
        componentUnitCost: compUnitCost.toString(),
        quantity: qty.toString(),
      },
    })
  }

  // ---- Direct cost (waste already inside materialTotal) ----
  const directCost = materialTotal.plus(laborCost).plus(otherDirect).plus(componentCost)

  // ---- Overhead allocation ----
  let overheadCost = ZERO
  for (const line of input.overhead) {
    const value = dec(line.value)
    let cost: Decimal
    let formula: string
    const inputs: Record<string, string> = { method: line.method, value: value.toString() }
    switch (line.method) {
      case 'per_unit':
        cost = reqNonNegative(value, `Overhead "${line.name}"`)
        formula = 'cost = amountPerUnit'
        break
      case 'per_batch':
        cost = reqNonNegative(value, `Overhead "${line.name}"`).div(batchSize)
        formula = 'cost = amountPerBatch ÷ batchSize'
        inputs.batchSize = batchSize.toString()
        break
      case 'pct_of_direct': {
        const frac = reqFraction(value, `Overhead "${line.name}" percentage`)
        cost = directCost.times(frac)
        formula = 'cost = directCost × fraction'
        inputs.directCost = directCost.toString()
        break
      }
      case 'per_hour': {
        if (line.hourlyRate === undefined) {
          throw new CostEngineError(`Overhead "${line.name}" uses per-hour allocation but no hourly rate was supplied.`)
        }
        const hours = reqNonNegative(value, `Overhead "${line.name}" hours`)
        const hourlyRate = reqNonNegative(line.hourlyRate, `Overhead "${line.name}" hourly rate`)
        cost = hours.times(hourlyRate)
        formula = 'cost = hoursPerUnit × hourlyOverheadRate'
        inputs.hourlyRate = hourlyRate.toString()
        break
      }
      case 'monthly_share': {
        if (line.monthlyAmount === undefined || line.monthlyUnits === undefined) {
          throw new CostEngineError(
            `Overhead "${line.name}" uses monthly-share allocation but monthly amount/units were not supplied.`,
          )
        }
        const share = reqFraction(value, `Overhead "${line.name}" share`)
        const monthlyAmount = reqNonNegative(line.monthlyAmount, `Overhead "${line.name}" monthly amount`)
        const monthlyUnits = reqNonNegative(line.monthlyUnits, `Overhead "${line.name}" monthly units`)
        if (monthlyUnits.isZero()) {
          throw new CostEngineError(`Overhead "${line.name}" monthly units must be greater than zero.`)
        }
        cost = share.times(monthlyAmount).div(monthlyUnits)
        formula = 'cost = share × monthlyAmount ÷ monthlyUnits'
        inputs.monthlyAmount = monthlyAmount.toString()
        inputs.monthlyUnits = monthlyUnits.toString()
        break
      }
      default:
        throw new CostEngineError(`Unknown overhead method "${(line as { method: string }).method}".`)
    }
    overheadCost = overheadCost.plus(cost)
    lines.push({
      label: `Overhead — ${line.name} (${line.method})`,
      category: 'overhead',
      amount: cost.toString(),
      formula,
      inputs,
    })
  }

  // ---- Totals ----
  const totalUnitCost = directCost.plus(overheadCost)
  const totalBatchCost = totalUnitCost.times(batchSize)
  const usableUnits = batchSize.times(ONE.minus(defectPct))
  const costPerUsableUnit = totalBatchCost.div(usableUnits)

  if (defectPct.gt(ZERO)) {
    assumptions.push(
      `${defectPct.times(100).toString()}% defective production assumed: batch cost is spread across ${usableUnits.toString()} usable units.`,
    )
  }
  if (input.components.length > 0) {
    assumptions.push(
      'Component costs are the components\' own full unit costs (their materials, labor, overhead and waste included once each).',
    )
  }

  return {
    materialCost: materialBase.toString(),
    packagingCost: packagingBase.toString(),
    serviceCost: serviceBase.toString(),
    laborCost: laborCost.toString(),
    otherDirectCost: otherDirect.toString(),
    componentCost: componentCost.toString(),
    directCost: directCost.toString(),
    overheadCost: overheadCost.toString(),
    wasteCost: wasteCost.toString(),
    totalUnitCost: totalUnitCost.toString(),
    totalBatchCost: totalBatchCost.toString(),
    usableUnits: usableUnits.toString(),
    costPerUsableUnit: costPerUsableUnit.toString(),
    lines,
    warnings,
    assumptions,
  }
}
