import { useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { Pct } from '../components/Pct.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, errMsg, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import { Field, NumberInput, Select, TextArea, TextInput, isDecimalString } from '../components/Form.js'
import { computeBundle, type AllocationMethod, type BundleItemInput } from '../../../engine/bundles.js'
import type { Bundle, BundleItem, DiscountType, ID, Product } from '../../../shared/types.js'

const ALLOCATIONS: Array<{ value: AllocationMethod; label: string; detail: string }> = [
  {
    value: 'proportional_cost',
    label: 'Proportional to cost',
    detail: 'Each item gets a share of the bundle price matching its share of total cost.',
  },
  {
    value: 'proportional_price',
    label: 'Proportional to list price',
    detail: 'Each item gets a share of the bundle price matching its share of total list price.',
  },
  {
    value: 'equal',
    label: 'Equal per unit',
    detail: 'The bundle price is split evenly across every unit in the bundle.',
  },
]

interface BundleComputeResult {
  totalCost: string
  totalListPrice: string
  bundlePrice: string
  discountAmount: string
  profit: string
  margin: string
  markup: string
  items: Array<{
    name: string
    unitCost: string
    unitPrice: string
    quantity: string
    priceSource: string
  }>
  assumptions: string[]
}

export default function Bundles() {
  const [bundleId, setBundleId] = useState('')
  const [creating, setCreating] = useState(false)
  const [allocation, setAllocation] = useState<AllocationMethod>('proportional_cost')
  const [result, setResult] = useState<BundleComputeResult | null>(null)
  const [allocated, setAllocated] = useState<ReturnType<typeof computeBundle> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Bundle | null>(null)

  const bundlesQ = useAsync(() => api.bundlesList(), [])
  const bundles = bundlesQ.data ?? []
  const productsQ = useAsync(() => api.productsList(false), [])
  const products = productsQ.data ?? []

  const itemsQ = useAsync(
    () => (bundleId ? api.bundleItemsList(Number(bundleId)) : Promise.resolve([] as BundleItem[])),
    [bundleId],
  )
  const items = itemsQ.data ?? []

  const bundle = bundles.find((b) => String(b.id) === bundleId)

  function selectBundle(id: string) {
    setBundleId(id)
    setResult(null)
    setAllocated(null)
    setError(null)
  }

  async function compute() {
    if (!bundleId || !bundle) return
    setBusy(true)
    setError(null)
    try {
      // Backend: authoritative totals + per-item unit costs/prices (from each
      // product's default pricing config, or unit cost when none exists).
      const raw = (await api.bundlesCompute(Number(bundleId))) as unknown as BundleComputeResult
      setResult(raw)
      // The backend's response overwrites the engine's allocated items, so the
      // per-item allocated revenue/profit table is computed client-side with
      // the same engine and the user's chosen allocation method.
      const discount =
        bundle.discount_type === 'none'
          ? { type: 'none' as const }
          : { type: bundle.discount_type as 'pct' | 'fixed', value: bundle.discount_value }
      const inputs: BundleItemInput[] = raw.items.map((it) => ({
        name: it.name,
        unitCost: it.unitCost,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
      }))
      setAllocated(computeBundle(inputs, discount, allocation))
    } catch (e) {
      setError(errMsg(e))
      setResult(null)
      setAllocated(null)
    }
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Bundles</h1>
        <button type="button" onClick={() => setCreating(true)}>
          New bundle
        </button>
      </div>
      <p className="muted">
        Sell products together at a bundle discount. Revenue is allocated back to items with an
        explicit method — never an invisible pro-rata.
      </p>

      {bundlesQ.loading ? (
        <Loading />
      ) : bundles.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No bundles yet"
            message="Create a bundle, add products with quantities, set a discount, and compute the bundle economics."
            action={
              <button type="button" onClick={() => setCreating(true)}>
                New bundle
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="card mb-16">
            <div className="toolbar">
              <Field label="Bundle">
                <Select
                  value={bundleId}
                  onChange={selectBundle}
                  options={[
                    { value: '', label: 'Pick a bundle…' },
                    ...bundles.map((b) => ({ value: String(b.id), label: b.name })),
                  ]}
                />
              </Field>
              {bundle ? (
                <>
                  <BundleEditor
                    bundle={bundle}
                    onChanged={() => {
                      bundlesQ.reload()
                      setResult(null)
                      setAllocated(null)
                    }}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setConfirmDelete(bundle)}
                  >
                    Delete bundle
                  </button>
                </>
              ) : null}
            </div>
            {error ? <ErrorBanner message={error} /> : null}
          </div>

          {bundle ? (
            <div className="card mb-16">
              <BundleItems
                bundle={bundle}
                items={items}
                products={products}
                onChanged={() => {
                  itemsQ.reload()
                  setResult(null)
                  setAllocated(null)
                }}
              />
            </div>
          ) : null}

          {bundle ? (
            <div className="card mb-16">
              <div className="section-title">Compute</div>
              <div className="form-grid">
                <Field label="Discount">
                  <span className="pill-row">
                    <span className="pill">
                      {bundle.discount_type === 'none'
                        ? 'No discount'
                        : bundle.discount_type === 'pct'
                          ? `${bundle.discount_value}% off`
                          : `${bundle.discount_value} off`}
                    </span>
                    <span className="muted">(edit in the bundle header above)</span>
                  </span>
                </Field>
                <Field label="Revenue allocation method">
                  <Select
                    value={allocation}
                    onChange={(v) => {
                      setAllocation(v as AllocationMethod)
                      setAllocated(null)
                    }}
                    options={ALLOCATIONS.map((a) => ({ value: a.value, label: a.label }))}
                  />
                </Field>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                {ALLOCATIONS.find((a) => a.value === allocation)?.detail}
              </p>
              <div className="toolbar">
                <button type="button" onClick={() => void compute()} disabled={busy || items.length === 0}>
                  {busy ? 'Computing…' : 'Compute bundle'}
                </button>
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="card">
              <div className="section-title">Bundle totals</div>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.bundlePrice} />
                  </div>
                  <div className="stat-label">Bundle price</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.totalCost} />
                  </div>
                  <div className="stat-label">Total cost</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.totalListPrice} />
                  </div>
                  <div className="stat-label">Total list price</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.discountAmount} />
                  </div>
                  <div className="stat-label">Discount amount</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num money">
                    <Money value={result.profit} />
                  </div>
                  <div className="stat-label">Profit</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">
                    <Pct value={result.margin} />
                  </div>
                  <div className="stat-label">Margin — profit as % of PRICE</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num">
                    <Pct value={result.markup} />
                  </div>
                  <div className="stat-label">Markup — profit as % of COST</div>
                </div>
              </div>

              {result.assumptions.length > 0 ? (
                <div className="notice mt-16">
                  <strong>Assumptions</strong>
                  <ul>
                    {result.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {allocated ? (
                <>
                  <div className="section-title" style={{ fontSize: 18, marginTop: 16 }}>
                    Per-item allocation (
                    {ALLOCATIONS.find((a) => a.value === allocation)?.label})
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>Item cost</th>
                        <th>List price</th>
                        <th>Allocated revenue</th>
                        <th>Allocated profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocated.items.map((it, i) => (
                        <tr key={i}>
                          <td>
                            {it.name}
                            <div className="muted" style={{ fontSize: 11 }}>
                              {result.items[i]?.priceSource}
                            </div>
                          </td>
                          <td>{it.quantity}</td>
                          <td className="money">
                            <Money value={it.itemCost} />
                          </td>
                          <td className="money">
                            <Money value={it.itemListPrice} />
                          </td>
                          <td className="money">
                            <Money value={it.allocatedRevenue} />
                          </td>
                          <td className={`money ${new Decimal(it.allocatedProfit).lt(0) ? 'danger-text' : 'success-text'}`}>
                            <Money value={it.allocatedProfit} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {creating ? (
        <BundleCreateModal
          onClose={() => setCreating(false)}
          onCreated={(b) => {
            setCreating(false)
            bundlesQ.reload()
            selectBundle(String(b.id))
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete bundle?"
          message={<p>Delete bundle "{confirmDelete.name}" and its items? This cannot be undone.</p>}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await api.bundlesDelete(confirmDelete.id)
              selectBundle('')
              bundlesQ.reload()
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

function BundleCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (b: Bundle) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  return (
    <Modal
      title="New bundle"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              if (!name.trim()) {
                setError('A bundle name is required.')
                return
              }
              setSaving(true)
              setError(null)
              try {
                const b = await api.bundlesCreate({ name: name.trim(), description })
                onCreated(b)
              } catch (e) {
                setError(errMsg(e))
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving…' : 'Create bundle'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Modal>
  )
}

function BundleEditor({ bundle, onChanged }: { bundle: Bundle; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bundle.name)
  const [description, setDescription] = useState(bundle.description)
  const [discountType, setDiscountType] = useState<DiscountType>(bundle.discount_type)
  const [discountValue, setDiscountValue] = useState(bundle.discount_value)
  const [error, setError] = useState<string | null>(null)

  if (!editing) {
    return (
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setName(bundle.name)
          setDescription(bundle.description)
          setDiscountType(bundle.discount_type)
          setDiscountValue(bundle.discount_value)
          setEditing(true)
        }}
      >
        Edit bundle
      </button>
    )
  }

  async function save() {
    if (!name.trim()) {
      setError('A bundle name is required.')
      return
    }
    if (discountType !== 'none') {
      if (!isDecimalString(discountValue) || new Decimal(discountValue).isNegative()) {
        setError('Discount value must be a number >= 0.')
        return
      }
      if (discountType === 'pct' && new Decimal(discountValue).gte(100)) {
        setError('Percentage discount must be below 100%.')
        return
      }
    }
    setError(null)
    try {
      await api.bundlesUpdate({
        id: bundle.id,
        name: name.trim(),
        description,
        discount_type: discountType,
        discount_value: discountType === 'none' ? '0' : discountValue.trim() || '0',
      })
      setEditing(false)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Modal
      title="Edit bundle"
      onClose={() => setEditing(false)}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Discount type">
          <Select
            value={discountType}
            onChange={(v) => setDiscountType(v as DiscountType)}
            options={[
              { value: 'none', label: 'No discount' },
              { value: 'pct', label: '% off the total list price' },
              { value: 'fixed', label: 'Fixed amount off' },
            ]}
          />
        </Field>
        {discountType !== 'none' ? (
          <Field label={discountType === 'pct' ? 'Discount %' : 'Discount amount'}>
            <NumberInput value={discountValue} onChange={setDiscountValue} />
          </Field>
        ) : null}
      </div>
    </Modal>
  )
}

function BundleItems({
  bundle,
  items,
  products,
  onChanged,
}: {
  bundle: Bundle
  items: BundleItem[]
  products: Product[]
  onChanged: () => void
}) {
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [editingQty, setEditingQty] = useState<BundleItem | null>(null)
  const [editQtyValue, setEditQtyValue] = useState('1')

  async function add() {
    if (!productId) {
      setError('Pick a product.')
      return
    }
    if (!isDecimalString(quantity) || !new Decimal(quantity).gt(0)) {
      setError('Quantity must be greater than zero.')
      return
    }
    setError(null)
    try {
      await api.bundleItemsAdd(bundle.id, {
        product_id: Number(productId),
        quantity: quantity.trim(),
      })
      setProductId('')
      setQuantity('1')
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div>
      <div className="section-title">Items</div>
      {error ? <ErrorBanner message={error} /> : null}
      {items.length === 0 ? (
        <p className="muted">No items yet — add products below.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Quantity</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.product_name ?? `#${it.product_id}`}</td>
                <td>{it.quantity}</td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setEditingQty(it)
                        setEditQtyValue(it.quantity)
                      }}
                    >
                      Edit qty
                    </button>
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={async () => {
                        try {
                          await api.bundleItemsRemove(it.id)
                          onChanged()
                        } catch (e) {
                          setError(errMsg(e))
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="toolbar mt-16">
        <Select
          value={productId}
          onChange={setProductId}
          options={[
            { value: '', label: 'Pick a product…' },
            ...products
              .filter((p) => !items.some((it) => it.product_id === p.id))
              .map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        />
        <NumberInput value={quantity} onChange={setQuantity} inputMode="numeric" />
        <button type="button" className="secondary" onClick={() => void add()}>
          Add item
        </button>
      </div>

      {editingQty ? (
        <Modal
          title={`Edit quantity — ${editingQty.product_name}`}
          onClose={() => setEditingQty(null)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setEditingQty(null)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!isDecimalString(editQtyValue) || !new Decimal(editQtyValue).gt(0)) {
                    setError('Quantity must be greater than zero.')
                    return
                  }
                  try {
                    await api.bundleItemsUpdate({ id: editingQty.id, quantity: editQtyValue.trim() })
                    setEditingQty(null)
                    onChanged()
                  } catch (e) {
                    setError(errMsg(e))
                  }
                }}
              >
                Save
              </button>
            </>
          }
        >
          <Field label="Quantity">
            <NumberInput value={editQtyValue} onChange={setEditQtyValue} inputMode="numeric" />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
