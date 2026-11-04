/**
 * Clever Signal Pricey — break-even calculator.
 *
 * Correct contribution-margin math:
 *   contributionPerUnit = sellingPrice − variableCostPerUnit
 *   breakEvenUnits      = fixedCosts ÷ contributionPerUnit  (rounded UP)
 *   breakEvenRevenue    = breakEvenUnits × sellingPrice
 *   targetProfitUnits   = (fixedCosts + targetProfit) ÷ contributionPerUnit
 *
 * Double-counting guard: fixed costs that are ALREADY allocated into the
 * product's per-unit cost must not also be entered as fixedCosts. The UI
 * asks explicitly and the explainer repeats the warning; the engine takes
 * the caller's word via the `variableCostExcludesFixed` flag and records
 * the assumption in the result.
 */
import Decimal from 'decimal.js'
import { dec, ZERO } from './money.js'

export class BreakEvenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BreakEvenError'
  }
}

export interface BreakEvenInput {
  fixedCosts: Decimal.Value
  variableCostPerUnit: Decimal.Value
  sellingPrice: Decimal.Value
  targetProfit?: Decimal.Value
  /** Caller confirms the variable cost has no allocated fixed overhead in it. */
  variableCostExcludesFixed?: boolean
}

export interface BreakEvenResult {
  contributionPerUnit: string
  contributionMargin: string
  breakEvenUnits: string | null
  breakEvenRevenue: string | null
  targetProfitUnits: string | null
  /** Human-readable caveats, e.g. double-counting warning. */
  notes: string[]
}

export function computeBreakEven(input: BreakEvenInput): BreakEvenResult {
  const fixed = dec(input.fixedCosts)
  const variable = dec(input.variableCostPerUnit)
  const price = dec(input.sellingPrice)
  const notes: string[] = []

  if (!fixed.isFinite() || fixed.isNegative()) throw new BreakEvenError('Fixed costs must be >= 0.')
  if (!variable.isFinite() || variable.isNegative()) throw new BreakEvenError('Variable cost per unit must be >= 0.')
  if (!price.isFinite() || price.lte(ZERO)) throw new BreakEvenError('Selling price must be > 0.')

  const contribution = price.minus(variable)
  const contributionMargin = contribution.div(price)

  if (!input.variableCostExcludesFixed) {
    notes.push(
      'Confirm the variable cost per unit does NOT include allocated fixed overhead — otherwise fixed costs are double-counted.',
    )
  }

  if (contribution.lte(ZERO)) {
    notes.push(
      'Contribution per unit is zero or negative: the price does not cover variable cost, so break-even is unreachable.',
    )
    return {
      contributionPerUnit: contribution.toString(),
      contributionMargin: contributionMargin.toString(),
      breakEvenUnits: null,
      breakEvenRevenue: null,
      targetProfitUnits: null,
      notes,
    }
  }

  const breakEvenUnits = fixed.div(contribution).ceil()
  const breakEvenRevenue = breakEvenUnits.times(price)

  let targetProfitUnits: string | null = null
  if (input.targetProfit !== undefined) {
    const target = dec(input.targetProfit)
    if (!target.isFinite() || target.isNegative()) throw new BreakEvenError('Target profit must be >= 0.')
    targetProfitUnits = fixed.plus(target).div(contribution).ceil().toString()
  }

  return {
    contributionPerUnit: contribution.toString(),
    contributionMargin: contributionMargin.toString(),
    breakEvenUnits: breakEvenUnits.toString(),
    breakEvenRevenue: breakEvenRevenue.toString(),
    targetProfitUnits,
    notes,
  }
}
