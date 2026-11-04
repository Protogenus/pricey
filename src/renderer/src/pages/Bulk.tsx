import { useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, errMsg, fmtDate, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import { Field, NumberInput, Select, TextInput, isDecimalString } from '../components/Form.js'
import type { BulkRule, BulkTier, ID, Product } from '../../../shared/types.js'
import type { BulkRow } from '../../../engine/bulk.js'

interface BulkComputeResult {
  rule: BulkRule
  tiers: BulkTier[]
  basePerUnit: { materialPerUnit: string; laborPerUnit: string; overheadPerUnit: string; otherPerUnit: string }
  rows: BulkRow[]
}

export default function Bulk() {
  const [productId, setProductId] = useState('')
  const [ruleId, setRuleId] = useState('')
  const [result, setResult] = useState<BulkComputeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<BulkRule | null>(null)

  const productsQ = useAsync(() => api.productsList(false), [])
  const products = productsQ.data ?? []

  const rulesQ = useAsync(
    () => (productId ? api.bulkRulesList(Number(productId)) : Promise.resolve([] as BulkRule[])),
    [productId],
  )
  const rules = rulesQ.data ?? []

  const tiersQ = useAsync(
    () => (ruleId ? api.bulkTiersList(Number(ruleId)) : Promise.resolve([] as BulkTier[])),
    [ruleId],
  )
  const tiers = tiersQ.data ?? []

  const rule = rules.find((r) => String(r.id) === ruleId)

  function selectProduct(id: string) {
    setProductId(id)
    setRuleId('')
    setResult(null)
    setError(null)
  }

  function selectRule(id: string) {
    setRuleId(id)
    setResult(null)
    setError(null)
  }

  async function compute() {
    if (!ruleId) return
    setBusy(true)
    setError(null)
    try {
      // The backend derives the quantities itself from the tier minimums
      // (plus 10× the largest) — the UI does not pass quantities.
      const raw = (await api.bulkCompute(Number(ruleId))) as unknown as BulkComputeResult
      setResult(raw)
    } catch (e) {
      setError(errMsg(e))
      setResult(null)
    }
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Bulk pricing</h1>
      </div>
      <p className="muted">
        Compare total and per-unit cost across production quantities. Each tier carries its own
        material discount, labor efficiency, setup cost and batch waste — cost is never assumed to
        fall linearly.
      </p>

      {productsQ.loading ? (
        <Loading />
      ) : products.length === 0 ? (
        <div className="card">
          <EmptyState title="No products yet" message="Create a product before modeling bulk pricing." />
        </div>
      ) : (
        <>
          <div className="card mb-16">
            <div className="form-grid">
              <Field label="Product">
                <Select
                  value={productId}
                  onChange={selectProduct}
                  options={[
                    { value: '', label: 'Pick a product…' },
                    ...products.map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                />
              </Field>
              <Field label="Bulk rule">
                <Select
                  value={ruleId}
                  onChange={selectRule}
                  disabled={!productId}
                  options={[
                    { value: '', label: 'Pick a rule…' },
                    ...rules.map((r) => ({ value: String(r.id), label: r.name })),
                  ]}
                />
              </Field>
            </div>
            <div className="toolbar">
              {productId ? <NewRuleButton productId={Number(productId)} onCreated={(r) => { rulesQ.reload(); selectRule(String(r.id)) }} /> : null}
              {rule ? (
                <button type="button" className="secondary" onClick={() => setConfirmDelete(rule)}>
                  Delete rule
                </button>
              ) : null}
            </div>
            {error ? <ErrorBanner message={error} /> : null}
          </div>

          {rule ? (
            <div className="card mb-16">
              <TierEditor
                rule={rule}
                tiers={tiers}
                onChanged={() => {
                  tiersQ.reload()
                  setResult(null)
                }}
              />
              <div className="toolbar mt-16">
                <button type="button" onClick={() => void compute()} disabled={busy || tiers.length === 0}>
                  {busy ? 'Computing…' : 'Compute bulk table'}
                </button>
              </div>
              {tiers.length === 0 ? (
                <p className="muted">Add at least one tier before computing.</p>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <div className="card">
              <div className="section-title">Bulk table — {result.rule.name}</div>
              <p className="muted" style={{ fontSize: 12 }}>
                Base per unit — materials <Money value={result.basePerUnit.materialPerUnit} /> ·
                labor <Money value={result.basePerUnit.laborPerUnit} /> · overhead{' '}
                <Money value={result.basePerUnit.overheadPerUnit} /> · other{' '}
                <Money value={result.basePerUnit.otherPerUnit} />
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Quantity</th>
                    <th>Tier used</th>
                    <th>Total cost</th>
                    <th>Cost / unit</th>
                    <th>Materials</th>
                    <th>Labor</th>
                    <th>Setup</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.quantity}>
                      <td>
                        <strong>{row.quantity.toLocaleString()}</strong>
                      </td>
                      <td>≥ {row.tierMinQty.toLocaleString()}</td>
                      <td className="money">
                        <Money value={row.totalCost} />
                      </td>
                      <td className="money">
                        <strong>
                          <Money value={row.costPerUnit} />
                        </strong>
                      </td>
                      <td className="money">
                        <Money value={row.materialTotal} />
                      </td>
                      <td className="money">
                        <Money value={row.laborTotal} />
                      </td>
                      <td className="money">
                        <Money value={row.fixedSetup} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete bulk rule?"
          message={
            <p>
              Delete rule "{confirmDelete.name}" and its tiers? This cannot be undone.
            </p>
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await api.bulkRulesDelete(confirmDelete.id)
              selectRule('')
              rulesQ.reload()
            } catch (e) {
              setError(errMsg(e))
            }
            setConfirmDelete(null)
          }}
        />
      ) : null}
    </div>
  )
}

function NewRuleButton({ productId, onCreated }: { productId: ID; onCreated: (r: BulkRule) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        New rule
      </button>
    )
  }
  return (
    <Modal
      title="New bulk rule"
      onClose={() => setOpen(false)}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!name.trim()) {
                setError('A rule name is required.')
                return
              }
              try {
                const r = await api.bulkRulesCreate({ product_id: productId, name: name.trim() })
                onCreated(r)
                setOpen(false)
              } catch (e) {
                setError(errMsg(e))
              }
            }}
          >
            Create rule
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field label="Rule name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Modal>
  )
}

function TierEditor({
  rule,
  tiers,
  onChanged,
}: {
  rule: BulkRule
  tiers: BulkTier[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<BulkTier | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BulkTier | null>(null)

  return (
    <div>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>
          Quantity tiers
        </div>
        <button type="button" className="secondary" onClick={() => setEditing('new')}>
          Add tier
        </button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {tiers.length === 0 ? (
        <EmptyState
          title="No tiers yet"
          message="Add quantity tiers — each with its own material discount, labor efficiency, setup cost and batch waste."
          action={
            <button type="button" onClick={() => setEditing('new')}>
              Add tier
            </button>
          }
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Min qty</th>
              <th>Material discount</th>
              <th>Labor efficiency</th>
              <th>Fixed setup</th>
              <th>Batch waste</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>≥ {t.min_qty.toLocaleString()}</strong>
                </td>
                <td>
                  {(Number(t.material_discount_pct) * 100).toFixed(2)}%
                </td>
                <td>
                  {(Number(t.labor_efficiency_pct) * 100).toFixed(2)}%
                </td>
                <td className="money">
                  <Money value={t.fixed_setup} />
                </td>
                <td>
                  {(Number(t.batch_waste_pct) * 100).toFixed(2)}%
                </td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="link-btn" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => setConfirmDelete(t)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing ? (
        <TierModal
          rule={rule}
          tier={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete tier?"
          message={<p>Delete the tier starting at {confirmDelete.min_qty.toLocaleString()} units?</p>}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await api.bulkTiersDelete(confirmDelete.id)
              onChanged()
            } catch (e) {
              setError(errMsg(e))
            }
            setConfirmDelete(null)
          }}
        />
      ) : null}
    </div>
  )
}

function TierModal({
  rule,
  tier,
  onClose,
  onSaved,
}: {
  rule: BulkRule
  tier?: BulkTier
  onClose: () => void
  onSaved: () => void
}) {
  const [minQty, setMinQty] = useState(tier ? String(tier.min_qty) : '100')
  const [matDisc, setMatDisc] = useState(tier ? String(Number(tier.material_discount_pct) * 100) : '0')
  const [labEff, setLabEff] = useState(tier ? String(Number(tier.labor_efficiency_pct) * 100) : '0')
  const [setup, setSetup] = useState(tier ? tier.fixed_setup : '0')
  const [waste, setWaste] = useState(tier ? String(Number(tier.batch_waste_pct) * 100) : '0')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function validate(): string | null {
    if (!/^\d+$/.test(minQty.trim()) || Number(minQty) <= 0) return 'Min quantity must be a whole number > 0.'
    for (const [v, label] of [
      [matDisc, 'Material discount %'],
      [labEff, 'Labor efficiency %'],
      [waste, 'Batch waste %'],
    ] as const) {
      if (!isDecimalString(v)) return `${label} must be a number.`
      const d = new Decimal(v)
      if (d.isNegative() || d.gte(100)) return `${label} must be in [0, 100).`
    }
    if (!isDecimalString(setup) || new Decimal(setup).isNegative()) return 'Fixed setup must be >= 0.'
    return null
  }

  async function save() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const frac = (v: string) => new Decimal(v).div(100).toString()
    try {
      if (tier) {
        await api.bulkTiersUpdate({
          id: tier.id,
          min_qty: Number(minQty),
          material_discount_pct: frac(matDisc),
          labor_efficiency_pct: frac(labEff),
          fixed_setup: new Decimal(setup).toString(),
          batch_waste_pct: frac(waste),
        })
      } else {
        await api.bulkTiersCreate({
          bulk_rule_id: rule.id,
          min_qty: Number(minQty),
          material_discount_pct: frac(matDisc),
          labor_efficiency_pct: frac(labEff),
          fixed_setup: new Decimal(setup).toString(),
          batch_waste_pct: frac(waste),
        })
      }
      onSaved()
    } catch (e) {
      setError(errMsg(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={tier ? `Edit tier (≥ ${tier.min_qty})` : 'Add tier'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save tier'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="form-grid">
        <Field label="Minimum quantity" hint="This tier applies from this quantity up.">
          <NumberInput value={minQty} onChange={setMinQty} inputMode="numeric" />
        </Field>
        <Field label="Material discount %" hint="Supplier discount on materials at this tier.">
          <NumberInput value={matDisc} onChange={setMatDisc} />
        </Field>
        <Field label="Labor efficiency %" hint="Reduction in labor time — configured explicitly, never assumed.">
          <NumberInput value={labEff} onChange={setLabEff} />
        </Field>
        <Field label="Fixed setup" hint="One-off setup cost per batch at this tier.">
          <NumberInput value={setup} onChange={setSetup} />
        </Field>
        <Field label="Batch waste %" hint="Waste fraction applied to materials at this tier.">
          <NumberInput value={waste} onChange={setWaste} />
        </Field>
      </div>
    </Modal>
  )
}
