import { useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { Pct } from '../components/Pct.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, errMsg, fmtDate, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import { Field, NumberInput, Select, TextInput, isDecimalString } from '../components/Form.js'
import {
  applyFeesToPrice,
  solvePriceWithFees,
  type FeeInput,
} from '../../../engine/fees.js'
import {
  marginFromPrice,
  markupFromPrice,
  priceForDiscountedMargin,
  priceFromMargin,
} from '../../../engine/pricing.js'
import type { CustomUnitDef } from '../../../engine/units.js'
import {
  computeCostClientSide,
  loadFullDeep,
  type DeepProductFull,
  type ScenarioCostOverrides,
} from '../lib/costInput.js'
import type { ProductCostResult } from '../../../engine/costing.js'
import type {
  ID,
  LaborRole,
  Material,
  OverheadItem,
  Product,
  ScenarioRec,
} from '../../../shared/types.js'

interface ScenarioData {
  deep: DeepProductFull
  materialsById: Map<number, Material>
  rolesById: Map<number, LaborRole>
  overheadById: Map<number, OverheadItem>
  customUnits: CustomUnitDef[]
  baseResult: ProductCostResult
}

async function loadScenarioData(productId: ID): Promise<ScenarioData> {
  const [deep, materials, roles, overheadItems, customUnitsRaw, baseRaw] = await Promise.all([
    loadFullDeep(api, productId),
    api.materialsList(false),
    api.laborList(false),
    api.overheadList(false),
    api.settingsGet('pricey.customUnits'),
    api.productsComputeCost(productId),
  ])
  let customUnits: CustomUnitDef[] = []
  try {
    const parsed = customUnitsRaw ? JSON.parse(customUnitsRaw) : []
    customUnits = Array.isArray(parsed) ? parsed : []
  } catch {
    customUnits = []
  }
  return {
    deep,
    materialsById: new Map(materials.map((m) => [m.id, m])),
    rolesById: new Map(roles.map((r) => [r.id, r])),
    overheadById: new Map(overheadItems.map((o) => [o.id, o])),
    customUnits,
    baseResult: baseRaw as unknown as ProductCostResult,
  }
}

interface Overrides {
  materialPricePct: string
  laborRatePct: string
  productionTimePct: string
  wastePct: string
  defectPct: string
  batchSize: string
  shipping: string
  targetMarginPct: string
  discountPct: string
  fees: FeeInput[]
}

const emptyOverrides: Overrides = {
  materialPricePct: '',
  laborRatePct: '',
  productionTimePct: '',
  wastePct: '',
  defectPct: '',
  batchSize: '',
  shipping: '',
  targetMarginPct: '',
  discountPct: '',
  fees: [],
}

function overridesFromJson(json: string): Overrides {
  const out = { ...emptyOverrides, fees: [] as FeeInput[] }
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const s = (k: string) => (p[k] === undefined || p[k] === null ? '' : String(p[k]))
    out.materialPricePct = s('materialPricePct')
    out.laborRatePct = s('laborRatePct')
    out.productionTimePct = s('productionTimePct')
    out.wastePct = s('wastePct')
    out.defectPct = s('defectPct')
    out.batchSize = s('batchSize')
    out.shipping = s('shipping')
    out.targetMarginPct = s('targetMarginPct')
    out.discountPct = s('discountPct')
    if (Array.isArray(p['fees'])) {
      out.fees = (p['fees'] as Array<Record<string, unknown>>).map((f) => ({
        name: String(f['name'] ?? 'fee'),
        type: (f['type'] ?? 'pct_on_price') as FeeInput['type'],
        value: String(f['value'] ?? '0'),
        treatment: (f['treatment'] ?? 'deducted') as FeeInput['treatment'],
      }))
    }
  } catch {
    /* keep defaults */
  }
  return out
}

/** Persisted shape: UI overrides plus the backend's CostOverrides subset so api.scenariosCompute also works. */
function overridesToJson(o: Overrides, data: ScenarioData): string {
  const costOv: ScenarioCostOverrides = {}
  if (o.materialPricePct.trim() !== '') costOv.materialPricePct = pctStrToFrac(o.materialPricePct)
  if (o.laborRatePct.trim() !== '') costOv.laborRatePct = pctStrToFrac(o.laborRatePct)
  if (o.productionTimePct.trim() !== '') costOv.productionTimePct = pctStrToFrac(o.productionTimePct)
  if (o.wastePct.trim() !== '') costOv.wastePct = pctStrToFrac(o.wastePct)
  if (o.defectPct.trim() !== '') costOv.defectPct = pctStrToFrac(o.defectPct)
  if (o.batchSize.trim() !== '') costOv.batchSize = Number(o.batchSize)

  // Backend-compatible subset: material purchase-price overrides, waste/defect/batch, fees.
  const backendMaterials: Record<string, { purchase_price: string }> = {}
  if (o.materialPricePct.trim() !== '') {
    const mult = new Decimal(1).plus(pctStrToFrac(o.materialPricePct))
    for (const line of data.deep.materials) {
      const mat = data.materialsById.get(line.material_id)
      if (mat) {
        backendMaterials[String(mat.id)] = {
          purchase_price: new Decimal(mat.purchase_price).times(mult).toString(),
        }
      }
    }
  }
  const backend: Record<string, unknown> = {}
  if (Object.keys(backendMaterials).length > 0) backend['materials'] = backendMaterials
  if (o.wastePct.trim() !== '') backend['wastePct'] = pctStrToFrac(o.wastePct)
  if (o.defectPct.trim() !== '') backend['defectPct'] = pctStrToFrac(o.defectPct)
  if (o.batchSize.trim() !== '') backend['batchSize'] = Number(o.batchSize)
  if (o.fees.length > 0) backend['fees'] = o.fees

  return JSON.stringify({ ...o, fees: o.fees, backend })
}

function pctStrToFrac(pct: string): string {
  return new Decimal(pct).div(100).toString()
}

interface PricedColumn {
  unitCost: string
  price: string | null
  netRevenue: string | null
  profit: string | null
  margin: string | null
}

/** Price pipeline, all engine math: cost → margin → discount → fees. */
function priceColumn(
  unitCost: string,
  targetMarginPct: string,
  discountPct: string,
  fees: FeeInput[],
): PricedColumn {
  const empty: PricedColumn = { unitCost, price: null, netRevenue: null, profit: null, margin: null }
  if (targetMarginPct.trim() === '' || !isDecimalString(targetMarginPct)) return empty
  const cost = new Decimal(unitCost)
  const margin = new Decimal(targetMarginPct).div(100)

  let listTarget = priceFromMargin(cost, margin)
  if (discountPct.trim() !== '' && isDecimalString(discountPct) && new Decimal(discountPct).gt(0)) {
    listTarget = priceForDiscountedMargin(cost, margin, new Decimal(discountPct).div(100))
  }
  let price = listTarget
  let netRevenue = listTarget
  if (fees.length > 0) {
    const solved = solvePriceWithFees(listTarget, fees, 1)
    price = new Decimal(solved.price)
    const applied = applyFeesToPrice(price, fees, 1)
    netRevenue = new Decimal(applied.netRevenue)
  }
  const profit = netRevenue.minus(cost)
  return {
    unitCost,
    price: price.toString(),
    netRevenue: netRevenue.toString(),
    profit: profit.toString(),
    margin: marginFromPrice(cost, netRevenue).toString(),
  }
}

export default function Scenarios() {
  const [productId, setProductId] = useState('')
  const [overrides, setOverrides] = useState<Overrides>({ ...emptyOverrides, fees: [] })
  const [scenarioId, setScenarioId] = useState('')
  const [scenarioName, setScenarioName] = useState('')
  const [feeDraft, setFeeDraft] = useState({ name: '', type: 'pct_on_price' as FeeInput['type'], value: '', treatment: 'deducted' as FeeInput['treatment'] })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [applying, setApplying] = useState(false)

  const productsQ = useAsync(() => api.productsList(false), [])
  const products = productsQ.data ?? []

  const dataQ = useAsync(
    () => (productId ? loadScenarioData(Number(productId)) : Promise.resolve(null)),
    [productId],
  )
  const data = dataQ.data ?? null

  const scenariosQ = useAsync(
    () => (productId ? api.scenariosList(Number(productId)) : Promise.resolve([] as ScenarioRec[])),
    [productId],
  )
  const scenarios = scenariosQ.data ?? []

  const setO = (k: keyof Overrides, v: string) =>
    setOverrides((o) => ({ ...o, [k]: v }))

  // LIVE preview — everything below is engine math on the client.
  const preview = useMemo(() => {
    if (!data) return null
    try {
      const deps = {
        materialsById: data.materialsById,
        laborRolesById: data.rolesById,
        overheadById: data.overheadById,
      }
      const base = computeCostClientSide(data.deep, deps, data.customUnits, {})
      const scOv: ScenarioCostOverrides = {
        materialPricePct: overrides.materialPricePct.trim() === '' ? undefined : pctStrToFrac(overrides.materialPricePct),
        laborRatePct: overrides.laborRatePct.trim() === '' ? undefined : pctStrToFrac(overrides.laborRatePct),
        productionTimePct: overrides.productionTimePct.trim() === '' ? undefined : pctStrToFrac(overrides.productionTimePct),
        wastePct: overrides.wastePct.trim() === '' ? undefined : pctStrToFrac(overrides.wastePct),
        defectPct: overrides.defectPct.trim() === '' ? undefined : pctStrToFrac(overrides.defectPct),
        batchSize: overrides.batchSize.trim() === '' ? undefined : Number(overrides.batchSize),
      }
      const sc = computeCostClientSide(data.deep, deps, data.customUnits, scOv)

      const ship = overrides.shipping.trim() === '' ? new Decimal(0) : new Decimal(overrides.shipping)
      const baseCost = new Decimal(base.result.totalUnitCost)
      const scCost = new Decimal(sc.result.totalUnitCost).plus(ship)

      const baseCol = priceColumn(baseCost.toString(), overrides.targetMarginPct, overrides.discountPct, overrides.fees)
      const scCol = priceColumn(scCost.toString(), overrides.targetMarginPct, overrides.discountPct, overrides.fees)

      return { base, sc, baseCol, scCol, shipping: ship.toString(), error: null as string | null }
    } catch (e) {
      return { base: null, sc: null, baseCol: null, scCol: null, shipping: '0', error: errMsg(e) }
    }
  }, [data, overrides])

  function validateOverrides(): string | null {
    const pct = (v: string, label: string, min?: number) => {
      if (v.trim() === '') return null
      if (!isDecimalString(v)) return `${label} must be a number.`
      const d = new Decimal(v)
      if (min !== undefined && d.lt(min)) return `${label} cannot be below ${min}%.`
      return null
    }
    for (const [v, l, min] of [
      [overrides.materialPricePct, 'Material price change', -100],
      [overrides.laborRatePct, 'Labor rate change', -100],
      [overrides.productionTimePct, 'Production time change', -100],
      [overrides.targetMarginPct, 'Target margin', 0],
      [overrides.discountPct, 'Discount', 0],
    ] as const) {
      const e = pct(v, l, min)
      if (e) return e
    }
    for (const [v, l] of [
      [overrides.wastePct, 'Waste %'],
      [overrides.defectPct, 'Defect %'],
    ] as const) {
      if (v.trim() === '') continue
      if (!isDecimalString(v)) return `${l} must be a number.`
      const d = new Decimal(v)
      if (d.isNegative() || d.gte(100)) return `${l} must be in [0, 100).`
    }
    if (overrides.batchSize.trim() !== '') {
      if (!isDecimalString(overrides.batchSize) || !new Decimal(overrides.batchSize).gt(0))
        return 'Batch size must be greater than zero.'
    }
    if (overrides.shipping.trim() !== '' && (!isDecimalString(overrides.shipping) || new Decimal(overrides.shipping).isNegative()))
      return 'Shipping must be >= 0.'
    if (overrides.targetMarginPct.trim() !== '' && new Decimal(overrides.targetMarginPct).gte(100))
      return 'Target margin must be below 100%.'
    if (overrides.discountPct.trim() !== '' && new Decimal(overrides.discountPct).gte(100))
      return 'Discount must be below 100%.'
    return null
  }

  async function selectProduct(id: string) {
    setProductId(id)
    setScenarioId('')
    setScenarioName('')
    setOverrides({ ...emptyOverrides, fees: [] })
    setError(null)
    setNotice(null)
  }

  function loadScenario(id: string) {
    setScenarioId(id)
    const sc = scenarios.find((s) => String(s.id) === id)
    if (!sc) {
      setScenarioName('')
      return
    }
    setScenarioName(sc.name)
    setOverrides(overridesFromJson(sc.overrides_json || '{}'))
    setNotice(`Loaded scenario "${sc.name}".`)
  }

  async function saveScenario() {
    if (!data || !productId) return
    const problem = validateOverrides()
    if (problem) {
      setError(problem)
      return
    }
    if (!scenarioName.trim()) {
      setError('Give the scenario a name before saving.')
      return
    }
    setError(null)
    try {
      const baseSnapshotJson = JSON.stringify(data.baseResult)
      const ovJson = overridesToJson(overrides, data)
      if (scenarioId) {
        await api.scenariosUpdate({ id: Number(scenarioId), name: scenarioName.trim(), base_snapshot_json: baseSnapshotJson, overrides_json: ovJson })
        setNotice(`Scenario "${scenarioName.trim()}" updated.`)
      } else {
        const created = await api.scenariosCreate({
          product_id: Number(productId),
          name: scenarioName.trim(),
          base_snapshot_json: baseSnapshotJson,
          overrides_json: ovJson,
        })
        setScenarioId(String(created.id))
        setNotice(`Scenario "${created.name}" saved.`)
      }
      scenariosQ.reload()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function duplicateScenario() {
    if (!scenarioId) return
    try {
      const dup = await api.scenariosDuplicate(Number(scenarioId))
      scenariosQ.reload()
      setScenarioId(String(dup.id))
      setScenarioName(dup.name)
      setNotice(`Duplicated as "${dup.name}".`)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function applyToProduct() {
    if (!data || !productId) return
    setApplying(true)
    setError(null)
    const log: string[] = []
    try {
      // Material price % → update each material's purchase price (recorded as a price event).
      if (overrides.materialPricePct.trim() !== '') {
        const mult = new Decimal(1).plus(pctStrToFrac(overrides.materialPricePct))
        for (const line of data.deep.materials) {
          const mat = data.materialsById.get(line.material_id)
          if (!mat) continue
          const newPrice = new Decimal(mat.purchase_price).times(mult).toString()
          await api.materialsUpdate({ id: mat.id, purchase_price: newPrice })
          log.push(`Material "${mat.name}": purchase price → ${newPrice}`)
        }
      }
      // Labor rate % / production time % → update labor lines.
      const full = await api.productsGetFull(Number(productId))
      if (overrides.laborRatePct.trim() !== '') {
        const mult = new Decimal(1).plus(pctStrToFrac(overrides.laborRatePct))
        for (const l of full.labor) {
          const newRate = new Decimal(l.rate).times(mult).toString()
          await api.productsUpdateLaborLine({ id: l.id, rate: newRate })
          log.push(`Labor "${l.task_name || l.role_name}": rate → ${newRate}`)
        }
      }
      if (overrides.productionTimePct.trim() !== '') {
        const mult = new Decimal(1).plus(pctStrToFrac(overrides.productionTimePct))
        for (const l of full.labor) {
          if (l.mode === 'fixed') continue
          const newQty = new Decimal(l.quantity).times(mult).toString()
          await api.productsUpdateLaborLine({ id: l.id, quantity: newQty })
          log.push(`Labor "${l.task_name || l.role_name}": quantity → ${newQty}`)
        }
      }
      // Waste / defect / batch → product record.
      const patch: Record<string, unknown> = {}
      if (overrides.wastePct.trim() !== '') patch['waste_pct'] = pctStrToFrac(overrides.wastePct)
      if (overrides.defectPct.trim() !== '') patch['defect_pct'] = pctStrToFrac(overrides.defectPct)
      if (overrides.batchSize.trim() !== '') patch['batch_size'] = Number(overrides.batchSize)
      if (Object.keys(patch).length > 0) {
        await api.productsUpdate({ id: Number(productId), ...patch })
        log.push(`Product settings updated: ${Object.keys(patch).join(', ')}`)
      }
      setNotice(
        `Applied to product. ${log.length} change${log.length === 1 ? '' : 's'}:\n${log.join('\n')}\n\nTarget margin, fees, discount and shipping are pricing assumptions — they were not written to the product.`,
      )
      dataQ.reload()
    } catch (e) {
      setError(`Apply failed partway: ${errMsg(e)}`)
    }
    setApplying(false)
    setConfirmApply(false)
  }

  const applySummary: string[] = []
  if (overrides.materialPricePct.trim() !== '') applySummary.push(`Scale every material's purchase price by ${overrides.materialPricePct}%`)
  if (overrides.laborRatePct.trim() !== '') applySummary.push(`Scale every labor line rate by ${overrides.laborRatePct}%`)
  if (overrides.productionTimePct.trim() !== '') applySummary.push(`Scale every labor line quantity (time) by ${overrides.productionTimePct}%`)
  if (overrides.wastePct.trim() !== '') applySummary.push(`Set product waste to ${overrides.wastePct}%`)
  if (overrides.defectPct.trim() !== '') applySummary.push(`Set product defect rate to ${overrides.defectPct}%`)
  if (overrides.batchSize.trim() !== '') applySummary.push(`Set batch size to ${overrides.batchSize}`)

  const rows: Array<{ label: string; base: string | null; sc: string | null; kind: 'money' | 'pct' }> = []
  if (preview && !preview.error && preview.baseCol && preview.scCol) {
    rows.push({ label: 'Unit cost', base: preview.baseCol.unitCost, sc: preview.scCol.unitCost, kind: 'money' })
    if (preview.baseCol.price !== null) {
      rows.push({ label: 'Selling price', base: preview.baseCol.price, sc: preview.scCol.price, kind: 'money' })
      rows.push({ label: 'Net revenue / unit', base: preview.baseCol.netRevenue, sc: preview.scCol.netRevenue, kind: 'money' })
      rows.push({ label: 'Profit / unit', base: preview.baseCol.profit, sc: preview.scCol.profit, kind: 'money' })
      rows.push({ label: 'Margin (profit ÷ price)', base: preview.baseCol.margin, sc: preview.scCol.margin, kind: 'pct' })
      const baseMk = safeMarkup(preview.baseCol.unitCost, preview.baseCol.netRevenue)
      const scMk = safeMarkup(preview.scCol.unitCost, preview.scCol.netRevenue)
      rows.push({ label: 'Markup (profit ÷ cost)', base: baseMk, sc: scMk, kind: 'pct' })
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Scenarios</h1>
      </div>
      <p className="muted">
        What-if analysis on a frozen cost snapshot. Overrides never touch your real data until you
        explicitly apply them. The live comparison below is computed in your browser by the pricing
        engine.
      </p>

      {productsQ.loading ? (
        <Loading />
      ) : products.length === 0 ? (
        <div className="card">
          <EmptyState title="No products yet" message="Create a product before running scenarios." />
        </div>
      ) : (
        <>
          <div className="card mb-16">
            <div className="form-grid">
              <Field label="Product">
                <Select
                  value={productId}
                  onChange={(v) => void selectProduct(v)}
                  options={[
                    { value: '', label: 'Pick a product…' },
                    ...products.map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                />
              </Field>
              <Field label="Saved scenario">
                <Select
                  value={scenarioId}
                  onChange={(v) => loadScenario(v)}
                  disabled={!productId}
                  options={[
                    { value: '', label: 'Unsaved scratch…' },
                    ...scenarios.map((s) => ({ value: String(s.id), label: s.name })),
                  ]}
                />
              </Field>
              <Field label="Scenario name">
                <TextInput
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="e.g. Supplier B pricing"
                />
              </Field>
            </div>
            <div className="toolbar">
              <button type="button" className="secondary" onClick={() => void saveScenario()} disabled={!data}>
                {scenarioId ? 'Update scenario' : 'Save scenario'}
              </button>
              {scenarioId ? (
                <>
                  <button type="button" className="secondary" onClick={() => void duplicateScenario()}>
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      if (!window.confirm(`Rename scenario to "${scenarioName.trim()}"?`)) return
                      try {
                        await api.scenariosUpdate({ id: Number(scenarioId), name: scenarioName.trim() })
                        scenariosQ.reload()
                        setNotice('Scenario renamed.')
                      } catch (e) {
                        setError(errMsg(e))
                      }
                    }}
                    disabled={!scenarioName.trim()}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      try {
                        await api.scenariosDelete(Number(scenarioId))
                        setScenarioId('')
                        setScenarioName('')
                        scenariosQ.reload()
                        setNotice('Scenario deleted.')
                      } catch (e) {
                        setError(errMsg(e))
                      }
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>
            {error ? <ErrorBanner message={error} /> : null}
            {notice ? (
              <div className="notice notice-success">
                <div style={{ whiteSpace: 'pre-wrap' }}>{notice}</div>
                <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => setNotice(null)}>
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>

          {dataQ.loading ? (
            <Loading label="Loading product cost structure…" />
          ) : dataQ.error ? (
            <ErrorBanner message={dataQ.error} onDismiss={dataQ.reload} />
          ) : data ? (
            <>
              <div className="two-col mb-16">
                <div className="card">
                  <div className="section-title">Cost overrides (scenario only)</div>
                  <div className="form-grid">
                    <Field label="Material prices ±%" hint="e.g. 5 = +5%, -10 = −10%.">
                      <NumberInput value={overrides.materialPricePct} onChange={(v) => setO('materialPricePct', v)} />
                    </Field>
                    <Field label="Labor rates ±%" hint="Scales every labor line rate.">
                      <NumberInput value={overrides.laborRatePct} onChange={(v) => setO('laborRatePct', v)} />
                    </Field>
                    <Field label="Production time ±%" hint="Scales labor quantities (minutes/units).">
                      <NumberInput value={overrides.productionTimePct} onChange={(v) => setO('productionTimePct', v)} />
                    </Field>
                    <Field label="Waste %" hint="Replaces the product's waste %.">
                      <NumberInput value={overrides.wastePct} onChange={(v) => setO('wastePct', v)} />
                    </Field>
                    <Field label="Defect %" hint="Replaces the product's defect %.">
                      <NumberInput value={overrides.defectPct} onChange={(v) => setO('defectPct', v)} />
                    </Field>
                    <Field label="Batch size" hint="Replaces the product's batch size.">
                      <NumberInput value={overrides.batchSize} onChange={(v) => setO('batchSize', v)} inputMode="numeric" />
                    </Field>
                    <Field label="Shipping / unit" hint="Added to the scenario's unit cost.">
                      <NumberInput value={overrides.shipping} onChange={(v) => setO('shipping', v)} />
                    </Field>
                  </div>
                </div>

                <div className="card">
                  <div className="section-title">Pricing assumptions (applied to both columns)</div>
                  <div className="form-grid">
                    <Field label="Target margin %" hint="Profit as % of PRICE.">
                      <NumberInput value={overrides.targetMarginPct} onChange={(v) => setO('targetMarginPct', v)} />
                    </Field>
                    <Field label="Discount %" hint="List price is raised so the discounted price still hits the margin.">
                      <NumberInput value={overrides.discountPct} onChange={(v) => setO('discountPct', v)} />
                    </Field>
                  </div>
                  <div className="section-title" style={{ fontSize: 16, marginTop: 12 }}>
                    Fee changes
                  </div>
                  {overrides.fees.length === 0 ? (
                    <p className="muted">No fee overrides — the margin price is the selling price.</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Value</th>
                          <th>Treatment</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {overrides.fees.map((f, i) => (
                          <tr key={i}>
                            <td>{f.name}</td>
                            <td>{f.type}</td>
                            <td>{f.type === 'pct_on_price' ? <Pct value={String(f.value)} /> : <Money value={String(f.value)} />}</td>
                            <td>
                              <span className="pill">{f.treatment}</span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="link-btn danger"
                                onClick={() =>
                                  setOverrides((o) => ({ ...o, fees: o.fees.filter((_, j) => j !== i) }))
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="form-grid mt-16">
                    <Field label="Fee name">
                      <TextInput value={feeDraft.name} onChange={(e) => setFeeDraft({ ...feeDraft, name: e.target.value })} />
                    </Field>
                    <Field label="Type">
                      <Select
                        value={feeDraft.type}
                        onChange={(v) => setFeeDraft({ ...feeDraft, type: v as FeeInput['type'] })}
                        options={[
                          { value: 'pct_on_price', label: '% of price' },
                          { value: 'fixed_per_unit', label: 'fixed / unit' },
                          { value: 'fixed_per_order', label: 'fixed / order' },
                        ]}
                      />
                    </Field>
                    <Field label={feeDraft.type === 'pct_on_price' ? 'Value (fraction, e.g. 0.065)' : 'Value'}>
                      <NumberInput value={feeDraft.value} onChange={(v) => setFeeDraft({ ...feeDraft, value: v })} />
                    </Field>
                    <Field label="Treatment">
                      <Select
                        value={feeDraft.treatment}
                        onChange={(v) => setFeeDraft({ ...feeDraft, treatment: v as FeeInput['treatment'] })}
                        options={[
                          { value: 'deducted', label: 'deducted' },
                          { value: 'included', label: 'included' },
                          { value: 'customer_pays', label: 'customer_pays' },
                        ]}
                      />
                    </Field>
                  </div>
                  <div className="toolbar">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        if (!feeDraft.name.trim() || !isDecimalString(feeDraft.value)) {
                          setError('Fee needs a name and a numeric value.')
                          return
                        }
                        setOverrides((o) => ({ ...o, fees: [...o.fees, { ...feeDraft }] }))
                        setFeeDraft({ name: '', type: 'pct_on_price', value: '', treatment: 'deducted' })
                      }}
                    >
                      Add fee
                    </button>
                  </div>
                </div>
              </div>

              <div className="card mb-16">
                <div className="section-title">Live comparison — computed by the engine</div>
                {preview?.error ? (
                  <ErrorBanner message={`Preview failed: ${preview.error}`} />
                ) : rows.length === 0 ? (
                  <p className="muted">
                    Set a target margin to see price, profit and margin. Unit cost compares live as
                    you type overrides.
                  </p>
                ) : (
                  <table className="compare-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th className="num">Original</th>
                        <th className="num">Scenario</th>
                        <th className="num">Δ</th>
                        <th className="num">Δ %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <CompareRow key={r.label} label={r.label} base={r.base} sc={r.sc} kind={r.kind} />
                      ))}
                    </tbody>
                  </table>
                )}
                {preview && !preview.error && preview.sc ? (
                  <p className="muted mt-16" style={{ fontSize: 12 }}>
                    Scenario batch cost <Money value={preview.sc.result.totalBatchCost} /> · per
                    usable unit <Money value={preview.sc.result.costPerUsableUnit} />
                    {new Decimal(preview.shipping).gt(0) ? (
                      <>
                        {' '}· includes <Money value={preview.shipping} /> shipping / unit
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>

              <div className="card">
                <div className="section-title">Apply to product</div>
                <p className="muted">
                  Writes the cost overrides into the product's real lines and settings. This is
                  explicit and confirmed — nothing is written by editing the form above.
                </p>
                {applySummary.length === 0 ? (
                  <p className="muted">No cost overrides set — nothing to apply.</p>
                ) : (
                  <>
                    <ul>
                      {applySummary.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                    <p className="muted">
                      Target margin, fees, discount and shipping are pricing assumptions — they are
                      not written to the product.
                    </p>
                    <button type="button" onClick={() => setConfirmApply(true)} disabled={applying}>
                      Apply to product…
                    </button>
                  </>
                )}
              </div>
            </>
          ) : null}
        </>
      )}

      {confirmApply ? (
        <ConfirmDialog
          title="Apply scenario to product?"
          message={
            <>
              <p>The following will be written to the product's real data:</p>
              <ul>
                {applySummary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <p className="muted">
                Material price changes are recorded as price events on each material. Consider
                saving a cost snapshot first — snapshots are never rewritten.
              </p>
            </>
          }
          confirmLabel={applying ? 'Applying…' : 'Apply'}
          onCancel={() => setConfirmApply(false)}
          onConfirm={() => void applyToProduct()}
        />
      ) : null}
    </div>
  )
}

function safeMarkup(cost: string, netRevenue: string | null): string | null {
  if (netRevenue === null) return null
  try {
    return markupFromPrice(cost, netRevenue).toString()
  } catch {
    return null
  }
}

function CompareRow({
  label,
  base,
  sc,
  kind,
}: {
  label: string
  base: string | null
  sc: string | null
  kind: 'money' | 'pct'
}) {
  let delta: string | null = null
  let deltaPct: string | null = null
  let cls = 'diff-zero'
  if (base !== null && sc !== null) {
    try {
      const d = new Decimal(sc).minus(base)
      delta = d.toString()
      // An increase is good for price/profit/margin/markup/revenue, bad for cost.
      const goodWhenUp = /profit|margin|markup|revenue|price/i.test(label)
      if (d.gt(0)) cls = goodWhenUp ? 'diff-pos' : 'diff-neg'
      else if (d.lt(0)) cls = goodWhenUp ? 'diff-neg' : 'diff-pos'
      const b = new Decimal(base)
      deltaPct = b.isZero() ? null : d.div(b).toString()
    } catch {
      /* leave null */
    }
  }
  const cell = (v: string | null) =>
    v === null ? (
      '—'
    ) : kind === 'money' ? (
      <Money value={v} />
    ) : (
      <Pct value={v} />
    )
  return (
    <tr>
      <td>{label}</td>
      <td className="num money">{cell(base)}</td>
      <td className="num money">{cell(sc)}</td>
      <td className={`num money ${cls}`}>
        {delta === null ? '—' : kind === 'money' ? <Money value={delta} /> : <Pct value={delta} signed />}
      </td>
      <td className={`num ${cls}`}>{deltaPct === null ? '—' : <Pct value={deltaPct} signed dp={1} />}</td>
    </tr>
  )
}
