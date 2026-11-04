import { useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { Pct } from '../components/Pct.js'
import { EmptyState } from '../components/EmptyState.js'
import { ExplainView } from '../components/ExplainView.js'
import { ErrorBanner, Loading, errMsg, useAsync } from '../components/hooks.js'
import { Field, NumberInput, Select, isDecimalString } from '../components/Form.js'
import { explainBreakEven } from '../../../engine/explain.js'
import type { BreakEvenResult } from '../../../engine/breakEven.js'
import type { ProductCostResult } from '../../../engine/costing.js'

// Verbatim double-counting warning (from the engine's break-even notes).
const DOUBLE_COUNT_WARNING =
  'Confirm the variable cost per unit does NOT include allocated fixed overhead — otherwise fixed costs are double-counted.'

export default function BreakEven() {
  const [fixedCosts, setFixedCosts] = useState('')
  const [variableCost, setVariableCost] = useState('')
  const [price, setPrice] = useState('')
  const [targetProfit, setTargetProfit] = useState('')
  const [excludesFixed, setExcludesFixed] = useState(false)
  const [productId, setProductId] = useState('')
  const [result, setResult] = useState<BreakEvenResult | null>(null)
  const [resultInput, setResultInput] = useState<{
    fixedCosts: string
    variableCostPerUnit: string
    sellingPrice: string
    targetProfit?: string
  } | null>(null)
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const productsQ = useAsync(() => api.productsList(false), [])
  const products = productsQ.data ?? []

  function validate(): string | null {
    const need = (v: string, label: string, allowZero: boolean) => {
      if (v.trim() === '' || !isDecimalString(v)) return `${label} must be a number.`
      const d = new Decimal(v)
      if (d.isNegative() || (!allowZero && d.lte(0))) return `${label} must be ${allowZero ? '>= 0' : '> 0'}.`
      return null
    }
    return (
      need(fixedCosts, 'Fixed costs', true) ??
      need(variableCost, 'Variable cost per unit', true) ??
      need(price, 'Selling price', false) ??
      (targetProfit.trim() === '' ? null : need(targetProfit, 'Target profit', true))
    )
  }

  async function calculate() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      // The IPC input type only declares the base fields, but the handler
      // forwards target_profit and variable_cost_excludes_fixed to the engine.
      const input = {
        fixed_costs: fixedCosts.trim(),
        unit_price: price.trim(),
        unit_variable_cost: variableCost.trim(),
        target_profit: targetProfit.trim() === '' ? undefined : targetProfit.trim(),
        variable_cost_excludes_fixed: excludesFixed,
      }
      const r = (await api.breakevenCalculate(
        input as Parameters<typeof api.breakevenCalculate>[0],
      )) as unknown as BreakEvenResult
      setResult(r)
      setResultInput({
        fixedCosts: fixedCosts.trim(),
        variableCostPerUnit: variableCost.trim(),
        sellingPrice: price.trim(),
        targetProfit: targetProfit.trim() === '' ? undefined : targetProfit.trim(),
      })
    } catch (e) {
      setError(errMsg(e))
      setResult(null)
    }
    setBusy(false)
  }

  async function loadFromProduct() {
    if (!productId) return
    setBusy(true)
    setError(null)
    try {
      const r = (await api.productsComputeCost(Number(productId))) as unknown as ProductCostResult
      setVariableCost(r.directCost)
      const p = products.find((x) => String(x.id) === productId)
      setLoadedFrom(p ? p.name : `#${productId}`)
      // Loading from a product can never satisfy the exclusion: direct cost
      // includes allocated overhead by construction.
      setExcludesFixed(false)
    } catch (e) {
      setError(`Could not compute product cost: ${errMsg(e)}`)
    }
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Break-even</h1>
      </div>
      <p className="muted">
        How many units you must sell to cover fixed costs — contribution math, rounded up, no
        estimates hidden.
      </p>

      <div className="card mb-16">
        <div className="form-grid">
          <Field label="Fixed costs" hint="Total fixed costs for the period (rent, salaries…).">
            <NumberInput value={fixedCosts} onChange={setFixedCosts} />
          </Field>
          <Field label="Variable cost / unit" hint="Materials, labor and per-unit costs for one unit.">
            <NumberInput value={variableCost} onChange={setVariableCost} />
          </Field>
          <Field label="Selling price / unit">
            <NumberInput value={price} onChange={setPrice} />
          </Field>
          <Field label="Target profit (optional)" hint="Extra profit beyond break-even.">
            <NumberInput value={targetProfit} onChange={setTargetProfit} />
          </Field>
        </div>

        <div className="notice notice-warning mt-16">
          <strong>Double-counting guard</strong>
          <div>{DOUBLE_COUNT_WARNING}</div>
          <label className="check-row" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              className="check"
              checked={excludesFixed}
              onChange={(e) => setExcludesFixed(e.target.checked)}
            />
            I confirm the variable cost above does NOT include allocated fixed overhead
          </label>
        </div>

        <div className="toolbar mt-16">
          <button type="button" onClick={() => void calculate()} disabled={busy}>
            {busy ? 'Calculating…' : 'Calculate break-even'}
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </div>

      <div className="card mb-16">
        <div className="section-title">Load from product</div>
        {productsQ.loading ? (
          <Loading />
        ) : products.length === 0 ? (
          <EmptyState title="No products yet" message="Create a product to load its cost here." />
        ) : (
          <>
            <div className="toolbar">
              <Select
                value={productId}
                onChange={setProductId}
                options={[
                  { value: '', label: 'Pick a product…' },
                  ...products.map((p) => ({ value: String(p.id), label: p.name })),
                ]}
              />
              <button type="button" className="secondary" onClick={() => void loadFromProduct()} disabled={!productId || busy}>
                Load direct cost as variable cost
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Uses the product's DIRECT cost only (materials incl. waste + labor + other +
              components — before overhead allocation) as the variable cost per unit.
            </p>
            {loadedFrom ? (
              <div className="notice notice-warning">
                <strong>Loaded from "{loadedFrom}"</strong>
                <div>{DOUBLE_COUNT_WARNING}</div>
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  The direct cost can still contain overhead allocated by per-unit / per-batch /
                  %-of-direct lines. Enter your fixed costs carefully.
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {result && resultInput ? (
        <div className="card">
          <div className="section-title">Results</div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-num money">
                <Money value={result.contributionPerUnit} />
              </div>
              <div className="stat-label">Contribution / unit (price − variable)</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">
                <Pct value={result.contributionMargin} />
              </div>
              <div className="stat-label">Contribution margin</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">
                {result.breakEvenUnits ?? 'unreachable'}
              </div>
              <div className="stat-label">Break-even units</div>
            </div>
            <div className="stat-card">
              <div className="stat-num money">
                {result.breakEvenRevenue ? <Money value={result.breakEvenRevenue} /> : 'unreachable'}
              </div>
              <div className="stat-label">Break-even revenue</div>
            </div>
            {result.targetProfitUnits !== null && result.targetProfitUnits !== undefined ? (
              <div className="stat-card">
                <div className="stat-num">{result.targetProfitUnits}</div>
                <div className="stat-label">
                  Units for <Money value={resultInput.targetProfit ?? '0'} /> profit
                </div>
              </div>
            ) : null}
          </div>

          {result.notes.length > 0 ? (
            <div className="notice mt-16">
              <strong>Notes</strong>
              <ul>
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-16">
            <ExplainView
              steps={explainBreakEven(
                {
                  fixedCosts: resultInput.fixedCosts,
                  variableCostPerUnit: resultInput.variableCostPerUnit,
                  sellingPrice: resultInput.sellingPrice,
                  targetProfit: resultInput.targetProfit,
                },
                result,
              )}
              title="How break-even was calculated"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
