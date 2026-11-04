/**
 * Clever Signal Pricey — calculation explainer.
 *
 * Every major calculation gets an explanation view: the actual formula with
 * the actual substituted values, step by step. Users never have to guess
 * how a number was produced.
 */
import Decimal from 'decimal.js'
import { dec, toMoneyString, toPctString } from './money.js'
import type { ProductCostInput, ProductCostResult } from './costing.js'
import type { FeeInput, FeeSolution } from './fees.js'
import type { BreakEvenInput, BreakEvenResult } from './breakEven.js'

export interface ExplainStep {
  title: string
  formula: string
  substituted: string
  result: string
}

const money = (v: Decimal.Value) => '$' + toMoneyString(v)

export function explainCost(input: ProductCostInput, result: ProductCostResult): ExplainStep[] {
  const steps: ExplainStep[] = []
  steps.push({
    title: '1 · Material cost',
    formula: 'Σ (quantity ÷ (1 − waste) × cost per unit), per material line',
    substituted: `${input.materials.length} material line(s) → base ${money(result.materialCost)} + packaging ${money(result.packagingCost)} + services ${money(result.serviceCost)}`,
    result: money(dec(result.materialCost).plus(result.packagingCost).plus(result.serviceCost)),
  })
  steps.push({
    title: '2 · Waste allowance',
    formula: 'line waste folded into required quantities + product waste applied once to the material subtotal',
    substituted: `product waste ${toPctString(input.wastePct)} on the material subtotal`,
    result: money(result.wasteCost),
  })
  steps.push({
    title: '3 · Labor cost',
    formula: 'hourly: rate × minutes ÷ 60 · per-minute: rate × minutes · per-unit: rate × units · fixed: charge',
    substituted: `${input.labor.length} labor line(s)`,
    result: money(result.laborCost),
  })
  steps.push({
    title: '4 · Other direct costs + components',
    formula: 'Σ other costs per unit + Σ component unit cost × quantity',
    substituted: `other ${money(result.otherDirectCost)} + components ${money(result.componentCost)}`,
    result: money(dec(result.otherDirectCost).plus(result.componentCost)),
  })
  steps.push({
    title: '5 · Direct cost',
    formula: 'materials (incl. product waste) + labor + other + components',
    substituted: `${money(dec(result.materialCost).plus(result.packagingCost).plus(result.serviceCost).plus(result.wasteCost))} + ${money(result.laborCost)} + ${money(result.otherDirectCost)} + ${money(result.componentCost)}`,
    result: money(result.directCost),
  })
  steps.push({
    title: '6 · Overhead allocation',
    formula: 'per-unit / per-batch ÷ batch / % of direct / per-hour × rate / monthly share',
    substituted: `${input.overhead.length} overhead rule(s) on direct cost ${money(result.directCost)}`,
    result: money(result.overheadCost),
  })
  steps.push({
    title: '7 · Total unit cost',
    formula: 'direct cost + overhead',
    substituted: `${money(result.directCost)} + ${money(result.overheadCost)}`,
    result: money(result.totalUnitCost),
  })
  steps.push({
    title: '8 · Batch totals',
    formula: 'batch = unit cost × batch size · usable = batch × (1 − defects)',
    substituted: `${money(result.totalUnitCost)} × ${input.batchSize.toString()} units, ${toPctString(input.defectPct)} defective`,
    result: `batch ${money(result.totalBatchCost)} · per usable unit ${money(result.costPerUsableUnit)}`,
  })
  return steps
}

export function explainPricing(
  method: string,
  params: Record<string, string>,
  price: Decimal.Value,
): ExplainStep[] {
  const p = dec(price)
  const step = (title: string, formula: string, substituted: string): ExplainStep => ({
    title, formula, substituted, result: money(p),
  })
  switch (method) {
    case 'margin':
      return [step(
        'Margin pricing',
        'price = cost ÷ (1 − margin)',
        `cost ${money(params.cost ?? '0')} ÷ (1 − ${params.margin ?? '0'})`,
      )]
    case 'markup':
      return [step(
        'Markup pricing',
        'price = cost × (1 + markup)',
        `cost ${money(params.cost ?? '0')} × (1 + ${params.markup ?? '0'})`,
      )]
    case 'fixed_profit':
      return [step(
        'Fixed-profit pricing',
        'price = cost + profit',
        `${money(params.cost ?? '0')} + ${money(params.profit ?? '0')}`,
      )]
    case 'cost_plus':
      return [step(
        'Cost-plus pricing',
        'price = Σ category cost × (1 + category markup)',
        params.detail ?? 'per-category markups applied',
      )]
    case 'minimum':
      return [step(
        'Minimum price',
        'price = covered costs + required profit',
        `${money(params.coveredCosts ?? '0')} + ${money(params.requiredProfit ?? '0')}`,
      )]
    case 'reference':
      return [step(
        'Reference comparison',
        'margin = (ref − cost) ÷ ref · markup = (ref − cost) ÷ cost',
        `reference ${money(params.refPrice ?? '0')} vs cost ${money(params.cost ?? '0')}`,
      )]
    default:
      return [step('Pricing', 'see method detail', JSON.stringify(params))]
  }
}

export function explainFees(
  targetNet: Decimal.Value,
  fees: FeeInput[],
  solution: FeeSolution,
): ExplainStep[] {
  const pctTotal = fees
    .filter((f) => f.type === 'pct_on_price' && f.treatment !== 'customer_pays')
    .reduce((s, f) => s.plus(dec(f.value)), dec(0))
  return [
    {
      title: '1 · Target net revenue',
      formula: 'the amount the seller must keep per unit',
      substituted: `target net ${money(targetNet)}`,
      result: money(targetNet),
    },
    {
      title: '2 · Fee algebra (no circular math)',
      formula: 'price = (net + fixed fees) ÷ (1 − total % fees)',
      substituted: `(${money(targetNet)} + fixed) ÷ (1 − ${toPctString(pctTotal)})`,
      result: money(solution.price),
    },
    {
      title: '3 · Fee breakdown on the solved price',
      formula: '% fees × price · fixed per unit · fixed per order ÷ quantity',
      substituted: solution.feeBreakdown.map((f) => `${f.name}: ${money(f.amount)} (${f.treatment})`).join(' · ') || 'no fees',
      result: `net ${money(solution.netRevenue)}`,
    },
  ]
}

export function explainBreakEven(input: BreakEvenInput, result: BreakEvenResult): ExplainStep[] {
  const steps: ExplainStep[] = [
    {
      title: '1 · Contribution per unit',
      formula: 'contribution = selling price − variable cost per unit',
      substituted: `${money(input.sellingPrice)} − ${money(input.variableCostPerUnit)}`,
      result: money(result.contributionPerUnit),
    },
    {
      title: '2 · Break-even quantity',
      formula: 'units = fixed costs ÷ contribution per unit (rounded up)',
      substituted: `${money(input.fixedCosts)} ÷ ${money(result.contributionPerUnit)}`,
      result: result.breakEvenUnits ?? 'unreachable',
    },
    {
      title: '3 · Break-even revenue',
      formula: 'revenue = break-even units × selling price',
      substituted: `${result.breakEvenUnits ?? '—'} × ${money(input.sellingPrice)}`,
      result: result.breakEvenRevenue ? money(result.breakEvenRevenue) : 'unreachable',
    },
  ]
  if (result.targetProfitUnits !== null && result.targetProfitUnits !== undefined) {
    steps.push({
      title: '4 · Units for target profit',
      formula: 'units = (fixed costs + target profit) ÷ contribution per unit (rounded up)',
      substituted: `(${money(input.fixedCosts)} + ${money(input.targetProfit ?? 0)}) ÷ ${money(result.contributionPerUnit)}`,
      result: result.targetProfitUnits,
    })
  }
  return steps
}
