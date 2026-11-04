/**
 * Clever Signal Pricey — input validation.
 *
 * Sensible guards for every calculation entry point: negative costs,
 * invalid percentages, margins of 100%+, missing cost information,
 * incompatible units, zero quantities, impossible configurations.
 * Each returns a list of human-readable problems (empty = valid).
 */
import Decimal from 'decimal.js'
import { dec, isValidNumber } from './money.js'
import { canConvert, type CustomUnitDef } from './units.js'
import type { ProductCostInput } from './costing.js'

function num(v: unknown): Decimal | null {
  try {
    const d = dec(v as Decimal.Value)
    return d.isFinite() ? d : null
  } catch {
    return null
  }
}

export function validateProductCostInput(
  input: ProductCostInput,
  customUnits: CustomUnitDef[] = [],
): string[] {
  const problems: string[] = []

  const batch = num(input.batchSize)
  if (!batch) problems.push('Batch size must be a number.')
  else if (batch.lte(0)) problems.push('Batch size must be greater than zero.')
  else if (!batch.isInteger()) problems.push('Batch size must be a whole number.')

  for (const frac of [['wastePct', input.wastePct, 'Waste'], ['defectPct', input.defectPct, 'Defective']] as const) {
    const d = num(frac[1])
    if (!d) problems.push(`${frac[2]} percentage must be a number.`)
    else if (d.isNegative() || d.gte(1)) problems.push(`${frac[2]} percentage must be between 0% (inclusive) and 100% (exclusive).`)
  }

  if (
    input.materials.length === 0 &&
    input.labor.length === 0 &&
    input.other.length === 0 &&
    input.components.length === 0
  ) {
    problems.push('The product has no cost information — add at least one material, labor, other cost or component.')
  }

  for (const line of input.materials) {
    const q = num(line.quantity)
    if (!q) problems.push(`Material "${line.material.name}": quantity must be a number.`)
    else if (q.isNegative()) problems.push(`Material "${line.material.name}": quantity cannot be negative.`)
    const w = num(line.wastePct)
    if (!w || w.isNegative() || w.gte(1)) problems.push(`Material "${line.material.name}": waste must be in [0, 100%).`)
    const cpu = num(line.material.costPerUnit)
    if (!cpu) problems.push(`Material "${line.material.name}": cost per unit must be a number.`)
    else if (cpu.isNegative()) problems.push(`Material "${line.material.name}": cost per unit cannot be negative.`)
    if (!canConvert(line.unit, line.material.unit, customUnits)) {
      problems.push(
        `Material "${line.material.name}": cannot convert "${line.unit}" to "${line.material.unit}" (incompatible units).`,
      )
    }
  }

  for (const line of input.labor) {
    const r = num(line.rate)
    if (!r) problems.push(`Labor "${line.taskName || line.mode}": rate must be a number.`)
    else if (r.isNegative()) problems.push(`Labor "${line.taskName || line.mode}": rate cannot be negative.`)
    const q = num(line.quantity)
    if (!q) problems.push(`Labor "${line.taskName || line.mode}": quantity must be a number.`)
    else if (q.isNegative()) problems.push(`Labor "${line.taskName || line.mode}": quantity cannot be negative.`)
    if (!['hourly', 'per_minute', 'per_unit', 'fixed'].includes(line.mode)) {
      problems.push(`Labor "${line.taskName || line.mode}": unknown mode "${line.mode}".`)
    }
  }

  for (const line of input.overhead) {
    const v = num(line.value)
    if (!v) problems.push(`Overhead "${line.name}": value must be a number.`)
    else if (v.isNegative()) problems.push(`Overhead "${line.name}": value cannot be negative.`)
    if (line.method === 'pct_of_direct' && v && (v.isNegative() || v.gte(1))) {
      problems.push(`Overhead "${line.name}": percentage of direct costs must be in [0, 100%).`)
    }
    if (line.method === 'per_hour' && line.hourlyRate === undefined) {
      problems.push(`Overhead "${line.name}": per-hour allocation needs an hourly rate.`)
    }
    if (line.method === 'monthly_share' && (line.monthlyAmount === undefined || line.monthlyUnits === undefined)) {
      problems.push(`Overhead "${line.name}": monthly-share allocation needs a monthly amount and monthly units.`)
    }
  }

  for (const oc of input.other) {
    const a = num(oc.amountPerUnit)
    if (!a) problems.push(`Other cost "${oc.name}": amount must be a number.`)
    else if (a.isNegative()) problems.push(`Other cost "${oc.name}": amount cannot be negative.`)
  }

  for (const comp of input.components) {
    const q = num(comp.quantity)
    if (!q) problems.push(`Component "${comp.product.name}": quantity must be a number.`)
    else if (q.lte(0)) problems.push(`Component "${comp.product.name}": quantity must be greater than zero.`)
  }

  return problems
}

export function validatePricingParams(
  method: string,
  params: Record<string, unknown>,
): string[] {
  const problems: string[] = []
  const cost = num(params.cost)
  if (params.cost !== undefined) {
    if (!cost) problems.push('Cost must be a number.')
    else if (cost.isNegative()) problems.push('Cost cannot be negative.')
  }
  switch (method) {
    case 'margin': {
      const m = num(params.margin)
      if (!m) problems.push('Margin must be a number.')
      else if (m.isNegative() || m.gte(1)) problems.push('Margin must be at least 0% and below 100%.')
      break
    }
    case 'markup': {
      const m = num(params.markup)
      if (!m) problems.push('Markup must be a number.')
      else if (m.lte(-1)) problems.push('Markup must be greater than −100%.')
      break
    }
    case 'fixed_profit':
    case 'target_profit':
    case 'minimum': {
      const p = num(params.profit ?? params.requiredProfit)
      if (!p) problems.push('Profit amount must be a number.')
      else if (p.isNegative()) problems.push('Profit amount cannot be negative.')
      break
    }
    case 'reference': {
      const r = num(params.refPrice)
      if (!r) problems.push('Reference price must be a number.')
      else if (r.lte(0)) problems.push('Reference price must be greater than zero.')
      break
    }
    case 'cost_plus':
      break
    default:
      problems.push(`Unknown pricing method "${method}".`)
  }
  return problems
}

/** True when a raw value is usable as a decimal input. */
export function isDecimalInput(v: unknown): boolean {
  return isValidNumber(v as Decimal.Value)
}
