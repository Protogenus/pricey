import { useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { Pct } from '../components/Pct.js'
import { EmptyState } from '../components/EmptyState.js'
import { ExplainView } from '../components/ExplainView.js'
import { ErrorBanner, Loading, errMsg, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import { Field, NumberInput, Select, TextInput, isDecimalString } from '../components/Form.js'
import {
  marginFromPrice,
  markupFromPrice,
  type RoundingStyle,
} from '../../../engine/pricing.js'
import type { ExplainStep } from '../../../engine/explain.js'
import type {
  Channel,
  ChannelFee,
  FeeTreatment,
  FeeType,
  ID,
  PriceChannel,
  PricingConfig,
  PricingMethod,
  Product,
} from '../../../shared/types.js'
import type { ProductCostResult } from '../../../engine/costing.js'

const METHODS: Array<{
  value: PricingMethod
  tab: string
  label: string
  formula: string
}> = [
  {
    value: 'margin',
    tab: 'Margin',
    label: 'Margin — profit as % of PRICE',
    formula: 'price = cost ÷ (1 − margin). Margin is profit ÷ price, never profit ÷ cost.',
  },
  {
    value: 'markup',
    tab: 'Markup',
    label: 'Markup — profit as % of COST',
    formula: 'price = cost × (1 + markup). Markup is profit ÷ cost, never profit ÷ price.',
  },
  {
    value: 'fixed_profit',
    tab: 'Fixed profit',
    label: 'Fixed profit — flat amount added to cost',
    formula: 'price = cost + profit.',
  },
  {
    value: 'target_profit',
    tab: 'Target profit',
    label: 'Target profit — flat amount added to cost',
    formula: 'price = cost + profit.',
  },
  {
    value: 'minimum',
    tab: 'Minimum',
    label: 'Minimum price — covers selected costs plus required profit',
    formula: 'price = covered costs + required profit. No margin math.',
  },
  {
    value: 'cost_plus',
    tab: 'Cost-plus',
    label: 'Cost-plus — per-category markups on cost',
    formula: 'price = Σ category cost × (1 + category markup).',
  },
  {
    value: 'reference',
    tab: 'Reference',
    label: 'Reference — compare against a market price you enter',
    formula: 'margin = (ref − cost) ÷ ref · markup = (ref − cost) ÷ cost.',
  },
]

const CHANNELS: PriceChannel[] = ['retail', 'wholesale', 'custom']
const ROUNDINGS: RoundingStyle[] = ['none', 'whole', 'nine', 'nine5']
const ROUNDING_LABEL: Record<RoundingStyle, string> = {
  none: 'No rounding',
  whole: 'Round up to whole dollars',
  nine: 'Round up to x.99',
  nine5: 'Round up to x.95',
}
const FEE_TYPES: FeeType[] = ['pct_on_price', 'fixed_per_unit', 'fixed_per_order']
const FEE_TYPE_LABEL: Record<FeeType, string> = {
  pct_on_price: '% of selling price',
  fixed_per_unit: 'Fixed amount per unit',
  fixed_per_order: 'Fixed amount per order',
}
const FEE_TREATMENTS: FeeTreatment[] = ['deducted', 'included', 'customer_pays']

interface PricingParams {
  marginPct: string
  markupPct: string
  profit: string
  coveredCosts: string
  requiredProfit: string
  refPrice: string
  markupMaterial: string
  markupLabor: string
  markupOverhead: string
  markupOther: string
}

const emptyParams: PricingParams = {
  marginPct: '',
  markupPct: '',
  profit: '',
  coveredCosts: '',
  requiredProfit: '',
  refPrice: '',
  markupMaterial: '',
  markupLabor: '',
  markupOverhead: '',
  markupOther: '',
}

interface CalcResult {
  method: string
  cost: string
  price: string
  netRevenue: string
  feeBreakdown: Array<{ name: string; type: string; treatment: string; amount: string }>
  explainer: ExplainStep[]
}

function pctToFrac(pct: string): string {
  return new Decimal(pct).div(100).toString()
}

function fracToPct(frac: string): string {
  try {
    return new Decimal(frac).times(100).toString()
  } catch {
    return ''
  }
}

function parseParams(json: string): { params: PricingParams; channelId: string; orderQty: string; rounding: RoundingStyle } {
  const out = { params: { ...emptyParams }, channelId: '', orderQty: '1', rounding: 'none' as RoundingStyle }
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const s = (k: string) => (p[k] === undefined || p[k] === null ? '' : String(p[k]))
    out.params.marginPct = p['margin'] !== undefined ? fracToPct(String(p['margin'])) : ''
    out.params.markupPct = p['markup'] !== undefined ? fracToPct(String(p['markup'])) : ''
    out.params.profit = s('profit')
    out.params.coveredCosts = s('coveredCosts')
    out.params.requiredProfit = s('requiredProfit')
    out.params.refPrice = s('refPrice')
    const markups = (p['markups'] ?? {}) as Record<string, unknown>
    out.params.markupMaterial = markups['material'] !== undefined ? fracToPct(String(markups['material'])) : ''
    out.params.markupLabor = markups['labor'] !== undefined ? fracToPct(String(markups['labor'])) : ''
    out.params.markupOverhead = markups['overhead'] !== undefined ? fracToPct(String(markups['overhead'])) : ''
    out.params.markupOther = markups['other'] !== undefined ? fracToPct(String(markups['other'])) : ''
    if (p['channelId'] !== undefined) out.channelId = String(p['channelId'])
    if (p['orderQty'] !== undefined) out.orderQty = String(p['orderQty'])
    if (typeof p['rounding'] === 'string' && (ROUNDINGS as string[]).includes(p['rounding'])) {
      out.rounding = p['rounding'] as RoundingStyle
    }
  } catch {
    /* keep defaults */
  }
  return out
}

function buildParamsJson(
  method: PricingMethod,
  p: PricingParams,
  channelId: string,
  orderQty: string,
  rounding: RoundingStyle,
): string {
  const json: Record<string, unknown> = {}
  const pct = (v: string) => pctToFrac(v)
  switch (method) {
    case 'margin':
      json['margin'] = pct(p.marginPct)
      break
    case 'markup':
      json['markup'] = pct(p.markupPct)
      break
    case 'fixed_profit':
    case 'target_profit':
      json['profit'] = p.profit.trim() || '0'
      break
    case 'minimum':
      if (p.coveredCosts.trim() !== '') json['coveredCosts'] = p.coveredCosts.trim()
      json['requiredProfit'] = p.requiredProfit.trim() || '0'
      break
    case 'cost_plus':
      json['markups'] = {
        material: p.markupMaterial.trim() === '' ? '0' : pct(p.markupMaterial),
        labor: p.markupLabor.trim() === '' ? '0' : pct(p.markupLabor),
        overhead: p.markupOverhead.trim() === '' ? '0' : pct(p.markupOverhead),
        other: p.markupOther.trim() === '' ? '0' : pct(p.markupOther),
      }
      break
    case 'reference':
      json['refPrice'] = p.refPrice.trim() || '0'
      break
  }
  if (channelId !== '') json['channelId'] = Number(channelId)
  json['orderQty'] = Number(orderQty) > 0 ? Number(orderQty) : 1
  json['rounding'] = rounding
  return JSON.stringify(json)
}

function validateParams(method: PricingMethod, p: PricingParams): string | null {
  const needPct = (v: string, label: string, max?: number) => {
    if (v.trim() === '' || !isDecimalString(v)) return `${label} must be a number.`
    const d = new Decimal(v)
    if (d.isNegative()) return `${label} cannot be negative.`
    if (max !== undefined && d.gte(max)) return `${label} must be below ${max}%.`
    return null
  }
  const needMoney = (v: string, label: string) => {
    if (v.trim() === '' || !isDecimalString(v)) return `${label} must be a number.`
    if (new Decimal(v).isNegative()) return `${label} cannot be negative.`
    return null
  }
  switch (method) {
    case 'margin':
      return needPct(p.marginPct, 'Margin', 100)
    case 'markup':
      return needPct(p.markupPct, 'Markup')
    case 'fixed_profit':
    case 'target_profit':
      return needMoney(p.profit, 'Profit')
    case 'minimum': {
      const a = p.coveredCosts.trim() === '' ? null : needMoney(p.coveredCosts, 'Covered costs')
      if (a) return a
      return needMoney(p.requiredProfit, 'Required profit')
    }
    case 'cost_plus':
      for (const [v, l] of [
        [p.markupMaterial, 'Materials markup'],
        [p.markupLabor, 'Labor markup'],
        [p.markupOverhead, 'Overhead markup'],
        [p.markupOther, 'Other markup'],
      ] as const) {
        if (v.trim() === '') continue
        const e = needPct(v, l)
        if (e) return e
      }
      return null
    case 'reference':
      if (p.refPrice.trim() === '' || !isDecimalString(p.refPrice)) return 'Reference price must be a number.'
      if (!new Decimal(p.refPrice).gt(0)) return 'Reference price must be greater than zero.'
      return null
  }
}

export default function Pricing() {
  const [productId, setProductId] = useState('')
  const [configId, setConfigId] = useState('')
  const [configName, setConfigName] = useState('')
  const [channel, setChannel] = useState<PriceChannel>('retail')
  const [method, setMethod] = useState<PricingMethod>('margin')
  const [params, setParams] = useState<PricingParams>({ ...emptyParams })
  const [channelId, setChannelId] = useState('')
  const [orderQty, setOrderQty] = useState('1')
  const [rounding, setRounding] = useState<RoundingStyle>('none')
  const [cost, setCost] = useState<ProductCostResult | null>(null)
  const [result, setResult] = useState<CalcResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [managingChannels, setManagingChannels] = useState(false)
  const [confirmDeleteCfg, setConfirmDeleteCfg] = useState<PricingConfig | null>(null)

  const productsQ = useAsync(() => api.productsList(false), [])
  const channelsQ = useAsync(() => api.channelsList(), [])
  const products = productsQ.data ?? []
  const channels = channelsQ.data ?? []

  const configsQ = useAsync(
    () => (productId ? api.pricingConfigsList(Number(productId)) : Promise.resolve([] as PricingConfig[])),
    [productId],
  )
  const configs = configsQ.data ?? []
  const feesQ = useAsync(
    () => (channelId ? api.channelFeesList(Number(channelId)) : Promise.resolve([] as ChannelFee[])),
    [channelId],
  )
  const fees = feesQ.data ?? []

  const setP = (k: keyof PricingParams, v: string) => setParams((p) => ({ ...p, [k]: v }))

  async function selectProduct(id: string) {
    setProductId(id)
    setConfigId('')
    setConfigName('')
    setMethod('margin')
    setParams({ ...emptyParams })
    setChannelId('')
    setOrderQty('1')
    setRounding('none')
    setResult(null)
    setCost(null)
    setError(null)
    setSavedMsg(null)
    if (!id) return
    setBusy(true)
    try {
      const r = (await api.productsComputeCost(Number(id))) as unknown as ProductCostResult
      setCost(r)
    } catch (e) {
      setError(`Could not compute cost: ${errMsg(e)}`)
    }
    setBusy(false)
  }

  function selectConfig(id: string) {
    setConfigId(id)
    setResult(null)
    setSavedMsg(null)
    setError(null)
    if (!id) {
      setConfigName('')
      return
    }
    const cfg = configs.find((c) => String(c.id) === id)
    if (!cfg) return
    setConfigName(cfg.name)
    setChannel(cfg.channel)
    setMethod(cfg.method)
    const parsed = parseParams(cfg.params_json)
    setParams(parsed.params)
    setChannelId(parsed.channelId)
    setOrderQty(parsed.orderQty)
    setRounding(parsed.rounding)
  }

  async function saveConfig(): Promise<ID | null> {
    setError(null)
    setSavedMsg(null)
    if (!productId) {
      setError('Pick a product first.')
      return null
    }
    const problem = validateParams(method, params)
    if (problem) {
      setError(problem)
      return null
    }
    if (!configName.trim()) {
      setError('Give the pricing config a name.')
      return null
    }
    const qty = Number(orderQty)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Order quantity must be greater than zero.')
      return null
    }
    setBusy(true)
    try {
      const paramsJson = buildParamsJson(method, params, channelId, orderQty, rounding)
      let cfg: PricingConfig
      if (configId) {
        cfg = await api.pricingConfigsUpdate({
          id: Number(configId),
          name: configName.trim(),
          channel,
          method,
          params_json: paramsJson,
        })
      } else {
        cfg = await api.pricingConfigsCreate({
          product_id: Number(productId),
          name: configName.trim(),
          channel,
          method,
          params_json: paramsJson,
        })
        setConfigId(String(cfg.id))
      }
      configsQ.reload()
      setSavedMsg(`Config "${cfg.name}" saved.`)
      return cfg.id
    } catch (e) {
      setError(errMsg(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function calculate() {
    // The backend calculates from a SAVED config — channelId/orderQty/rounding
    // ride inside params_json — so save first, then calculate by config id.
    const id = await saveConfig()
    if (id === null) return
    setBusy(true)
    setError(null)
    try {
      const r = (await api.pricingCalculate(id)) as unknown as CalcResult
      setResult(r)
    } catch (e) {
      setError(errMsg(e))
      setResult(null)
    }
    setBusy(false)
  }

  const methodMeta = METHODS.find((m) => m.value === method) as (typeof METHODS)[number]

  let profit: string | null = null
  let margin: string | null = null
  let markup: string | null = null
  if (result) {
    try {
      profit = new Decimal(result.netRevenue).minus(result.cost).toString()
      margin = marginFromPrice(result.cost, result.netRevenue).toString()
      markup = markupFromPrice(result.cost, result.netRevenue).toString()
    } catch {
      profit = null
      margin = null
      markup = null
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Pricing</h1>
      </div>

      {productsQ.loading ? (
        <Loading />
      ) : products.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No products yet"
            message="Create a product before calculating a price."
          />
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
              <Field label="Pricing config">
                <Select
                  value={configId}
                  onChange={(v) => selectConfig(v)}
                  disabled={!productId}
                  options={[
                    { value: '', label: 'New config…' },
                    ...configs.map((c) => ({
                      value: String(c.id),
                      label: `${c.name} (${c.method}, ${c.channel})`,
                    })),
                  ]}
                />
              </Field>
            </div>

            {cost ? (
              <div className="notice">
                <strong>Unit cost</strong>
                <div className="money" style={{ fontSize: 20 }}>
                  <Money value={cost.totalUnitCost} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  direct <Money value={cost.directCost} /> + overhead{' '}
                  <Money value={cost.overheadCost} /> · batch <Money value={cost.totalBatchCost} /> ·{' '}
                  per usable unit <Money value={cost.costPerUsableUnit} />
                </div>
              </div>
            ) : null}

            {error ? <ErrorBanner message={error} /> : null}

            {productId ? (
              <>
                <Field label="Config name">
                  <TextInput
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="e.g. Retail 40% margin"
                    style={{ maxWidth: 420 }}
                  />
                </Field>

                <div className="section-title" style={{ fontSize: 18, marginTop: 8 }}>
                  Pricing method
                </div>
                <div className="tabs">
                  {METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={method === m.value ? 'selected' : ''}
                      onClick={() => setMethod(m.value)}
                    >
                      {m.tab}
                    </button>
                  ))}
                </div>
                <div className="notice">
                  <span className="method-label">{methodMeta.label}</span>
                  <span className="method-formula">{methodMeta.formula}</span>
                </div>

                <MethodParams
                  method={method}
                  params={params}
                  setP={setP}
                  unitCost={cost?.totalUnitCost}
                />

                <div className="section-title" style={{ fontSize: 18, marginTop: 16 }}>
                  Sales channel & fees
                </div>
                <div className="form-grid">
                  <Field label="Price channel">
                    <Select
                      value={channel}
                      onChange={(v) => setChannel(v as PriceChannel)}
                      options={CHANNELS.map((c) => ({ value: c, label: c }))}
                    />
                  </Field>
                  <Field label="Fee channel (loads its fees into the calculation)">
                    <Select
                      value={channelId}
                      onChange={setChannelId}
                      options={[
                        { value: '', label: 'No channel — no fees' },
                        ...channels.map((c: Channel) => ({
                          value: String(c.id),
                          label: `${c.name}${c.kind ? ` (${c.kind})` : ''}`,
                        })),
                      ]}
                    />
                  </Field>
                  <Field label="Order quantity" hint="Per-order fees are divided by this.">
                    <NumberInput value={orderQty} onChange={setOrderQty} inputMode="numeric" />
                  </Field>
                  <Field label="Rounding">
                    <Select
                      value={rounding}
                      onChange={(v) => setRounding(v as RoundingStyle)}
                      options={ROUNDINGS.map((r) => ({ value: r, label: ROUNDING_LABEL[r] }))}
                    />
                  </Field>
                </div>
                <div className="toolbar">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setManagingChannels(true)}
                  >
                    Manage channels & fees
                  </button>
                </div>

                {channelId ? (
                  fees.length === 0 ? (
                    <p className="muted">This channel has no fees configured.</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Fee</th>
                          <th>Type</th>
                          <th>Value</th>
                          <th>Treatment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fees.map((f) => (
                          <tr key={f.id}>
                            <td>{f.name}</td>
                            <td>{FEE_TYPE_LABEL[f.fee_type]}</td>
                            <td>
                              {f.fee_type === 'pct_on_price' ? (
                                <Pct value={f.value} />
                              ) : (
                                <Money value={f.value} />
                              )}
                            </td>
                            <td>
                              <span className="pill">{f.treatment}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : null}

                <div className="toolbar mt-16">
                  <button type="button" className="secondary" onClick={() => void saveConfig()} disabled={busy}>
                    Save config
                  </button>
                  <button type="button" onClick={() => void calculate()} disabled={busy}>
                    {busy ? 'Working…' : 'Save & calculate price'}
                  </button>
                  {configId ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        const cfg = configs.find((c) => String(c.id) === configId)
                        if (cfg) setConfirmDeleteCfg(cfg)
                      }}
                    >
                      Delete config
                    </button>
                  ) : null}
                  {savedMsg ? <span className="success-text">{savedMsg}</span> : null}
                </div>
              </>
            ) : null}
          </div>

          {result ? (
            <div className="card">
              <div className="section-title">Result</div>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.price} />
                  </div>
                  <div className="stat-label">Selling price</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.netRevenue} />
                  </div>
                  <div className="stat-label">Net revenue (after fees)</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num money">
                    {profit !== null ? <Money value={profit} /> : '—'}
                  </div>
                  <div className="stat-label">Profit per unit (net − cost)</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">
                    {margin !== null ? <Pct value={margin} /> : '—'}
                  </div>
                  <div className="stat-label">Margin — profit as % of PRICE</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">
                    {markup !== null ? <Pct value={markup} /> : '—'}
                  </div>
                  <div className="stat-label">Markup — profit as % of COST</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.cost} />
                  </div>
                  <div className="stat-label">Unit cost</div>
                </div>
              </div>

              {result.feeBreakdown.length > 0 ? (
                <>
                  <div className="section-title" style={{ fontSize: 18, marginTop: 8 }}>
                    Fee breakdown
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Fee</th>
                        <th>Treatment</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.feeBreakdown.map((f, i) => (
                        <tr key={i}>
                          <td>
                            {f.name} <span className="muted">({f.type})</span>
                          </td>
                          <td>
                            <span className="pill">{f.treatment}</span>
                          </td>
                          <td className="money">
                            <Money value={f.amount} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}

              <div className="mt-16">
                <ExplainView steps={result.explainer} title="How the price was calculated" />
              </div>
            </div>
          ) : null}
        </>
      )}

      {managingChannels ? (
        <ChannelManager
          onClose={() => {
            setManagingChannels(false)
            channelsQ.reload()
            feesQ.reload()
          }}
        />
      ) : null}

      {confirmDeleteCfg ? (
        <ConfirmDialog
          title="Delete pricing config?"
          message={<p>Delete config "{confirmDeleteCfg.name}"? This cannot be undone.</p>}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDeleteCfg(null)}
          onConfirm={async () => {
            try {
              await api.pricingConfigsDelete(confirmDeleteCfg.id)
              setConfigId('')
              setConfigName('')
              configsQ.reload()
            } catch (e) {
              setError(errMsg(e))
            }
            setConfirmDeleteCfg(null)
          }}
        />
      ) : null}
    </div>
  )
}

function MethodParams({
  method,
  params,
  setP,
  unitCost,
}: {
  method: PricingMethod
  params: PricingParams
  setP: (k: keyof PricingParams, v: string) => void
  unitCost?: string
}) {
  switch (method) {
    case 'margin':
      return (
        <Field
          label="Target margin (%)"
          hint="Profit as % of PRICE. 40 = you keep 40% of the selling price as profit."
        >
          <NumberInput value={params.marginPct} onChange={(v) => setP('marginPct', v)} />
        </Field>
      )
    case 'markup':
      return (
        <Field
          label="Markup (%)"
          hint="Profit as % of COST. 150 = price is cost plus 150% of cost."
        >
          <NumberInput value={params.markupPct} onChange={(v) => setP('markupPct', v)} />
        </Field>
      )
    case 'fixed_profit':
    case 'target_profit':
      return (
        <Field label="Profit amount" hint="Flat currency amount added to the unit cost.">
          <NumberInput value={params.profit} onChange={(v) => setP('profit', v)} />
        </Field>
      )
    case 'minimum':
      return (
        <div className="form-grid">
          <Field
            label="Covered costs"
            hint={unitCost ? `Defaults to the full unit cost (${unitCost}).` : 'Defaults to the full unit cost.'}
          >
            <NumberInput
              value={params.coveredCosts}
              onChange={(v) => setP('coveredCosts', v)}
              placeholder={unitCost ?? ''}
            />
          </Field>
          <Field label="Required profit" hint="Flat amount the price must clear above covered costs.">
            <NumberInput value={params.requiredProfit} onChange={(v) => setP('requiredProfit', v)} />
          </Field>
        </div>
      )
    case 'cost_plus':
      return (
        <>
          <p className="muted">
            Each cost category gets its own markup on cost — price = Σ category cost × (1 +
            markup).
          </p>
          <div className="form-grid">
            <Field label="Materials markup (%)">
              <NumberInput value={params.markupMaterial} onChange={(v) => setP('markupMaterial', v)} />
            </Field>
            <Field label="Labor markup (%)">
              <NumberInput value={params.markupLabor} onChange={(v) => setP('markupLabor', v)} />
            </Field>
            <Field label="Overhead markup (%)">
              <NumberInput value={params.markupOverhead} onChange={(v) => setP('markupOverhead', v)} />
            </Field>
            <Field label="Other & components markup (%)">
              <NumberInput value={params.markupOther} onChange={(v) => setP('markupOther', v)} />
            </Field>
          </div>
        </>
      )
    case 'reference':
      return (
        <Field
          label="Reference market price"
          hint="A price you enter manually — Pricey compares your cost against it and reports the margin and markup it implies."
        >
          <NumberInput value={params.refPrice} onChange={(v) => setP('refPrice', v)} />
        </Field>
      )
    default:
      return null
  }
}

function ChannelManager({ onClose }: { onClose: () => void }) {
  const q = useAsync(() => api.channelsList(), [])
  const [selectedId, setSelectedId] = useState('')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const channels = q.data ?? []

  const feesQ = useAsync(
    () => (selectedId ? api.channelFeesList(Number(selectedId)) : Promise.resolve([] as ChannelFee[])),
    [selectedId],
  )
  const fees = feesQ.data ?? []

  const [feeName, setFeeName] = useState('')
  const [feeType, setFeeType] = useState<FeeType>('pct_on_price')
  const [feeValue, setFeeValue] = useState('')
  const [feeTreatment, setFeeTreatment] = useState<FeeTreatment>('deducted')
  const [confirmDeleteFee, setConfirmDeleteFee] = useState<ChannelFee | null>(null)

  async function addChannel() {
    if (!newName.trim()) {
      setError('A channel name is required.')
      return
    }
    setError(null)
    try {
      const c = await api.channelsCreate({ name: newName.trim() })
      setNewName('')
      q.reload()
      setSelectedId(String(c.id))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function addFee() {
    if (!selectedId) return
    if (!feeName.trim()) {
      setError('A fee name is required.')
      return
    }
    if (!isDecimalString(feeValue) || new Decimal(feeValue).isNegative()) {
      setError('Fee value must be a number >= 0.')
      return
    }
    setError(null)
    try {
      const value =
        feeType === 'pct_on_price' ? pctToFrac(feeValue) : new Decimal(feeValue).toString()
      await api.channelFeesCreate({
        channel_id: Number(selectedId),
        name: feeName.trim(),
        fee_type: feeType,
        value,
        treatment: feeTreatment,
      })
      setFeeName('')
      setFeeValue('')
      feesQ.reload()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Modal
      title="Channels & fees"
      onClose={onClose}
      wide
      footer={
        <button type="button" className="secondary" onClick={onClose}>
          Done
        </button>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="form-grid">
        <Field label="Channels">
          <Select
            value={selectedId}
            onChange={setSelectedId}
            options={[
              { value: '', label: 'Pick a channel…' },
              ...channels.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
        </Field>
        <Field label="New channel name">
          <div className="toolbar" style={{ margin: 0 }}>
            <TextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Etsy"
            />
            <button type="button" className="secondary" onClick={() => void addChannel()}>
              Add
            </button>
          </div>
        </Field>
      </div>

      {selectedId ? (
        <>
          <div className="section-title" style={{ fontSize: 16 }}>
            Fees
          </div>
          {fees.length === 0 ? (
            <p className="muted">No fees on this channel yet.</p>
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
                {fees.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>{FEE_TYPE_LABEL[f.fee_type]}</td>
                    <td>
                      {f.fee_type === 'pct_on_price' ? <Pct value={f.value} /> : <Money value={f.value} />}
                    </td>
                    <td>
                      <span className="pill">{f.treatment}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => setConfirmDeleteFee(f)}
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
              <TextInput value={feeName} onChange={(e) => setFeeName(e.target.value)} />
            </Field>
            <Field label="Type">
              <Select
                value={feeType}
                onChange={(v) => setFeeType(v as FeeType)}
                options={FEE_TYPES.map((t) => ({ value: t, label: FEE_TYPE_LABEL[t] }))}
              />
            </Field>
            <Field
              label={feeType === 'pct_on_price' ? 'Value (%)' : 'Value'}
              hint={
                feeType === 'pct_on_price'
                  ? 'Percent of the selling price, e.g. 6.5.'
                  : feeType === 'fixed_per_unit'
                    ? 'Currency amount per unit sold.'
                    : 'Currency amount per order (divided by order quantity).'
              }
            >
              <NumberInput value={feeValue} onChange={setFeeValue} />
            </Field>
            <Field label="Treatment">
              <Select
                value={feeTreatment}
                onChange={(v) => setFeeTreatment(v as FeeTreatment)}
                options={FEE_TREATMENTS.map((t) => ({ value: t, label: t }))}
              />
            </Field>
          </div>
          <div className="toolbar">
            <button type="button" className="secondary" onClick={() => void addFee()}>
              Add fee
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            deducted / included fees reduce what you keep; customer_pays fees are added on top of
            the price and don't affect your net.
          </p>
        </>
      ) : null}

      {confirmDeleteFee ? (
        <ConfirmDialog
          title="Remove fee?"
          message={<p>Remove fee "{confirmDeleteFee.name}"?</p>}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmDeleteFee(null)}
          onConfirm={async () => {
            try {
              await api.channelFeesDelete(confirmDeleteFee.id)
              feesQ.reload()
            } catch (e) {
              setError(errMsg(e))
            }
            setConfirmDeleteFee(null)
          }}
        />
      ) : null}
    </Modal>
  )
}
