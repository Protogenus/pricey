import { useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, errMsg, fmtDate, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import {
  Field,
  NumberInput,
  Select,
  TextArea,
  TextInput,
  UnitSelect,
  isDecimalString,
} from '../components/Form.js'
import type {
  Material,
  MaterialCategory,
  MaterialPriceEvent,
  Product,
  UnitDimension,
} from '../../../shared/types.js'
import type { CustomUnitDef } from '../../../engine/units.js'

const CATEGORIES: MaterialCategory[] = ['material', 'packaging', 'service', 'other']
const DIMENSIONS: UnitDimension[] = ['mass', 'volume', 'length', 'area', 'count', 'custom']

interface MaterialFormState {
  name: string
  description: string
  category: MaterialCategory
  unit: string
  unit_dimension: UnitDimension
  purchase_qty: string
  purchase_price: string
  supplier: string
  tax_note: string
  notes: string
}

const emptyForm: MaterialFormState = {
  name: '',
  description: '',
  category: 'material',
  unit: 'piece',
  unit_dimension: 'count',
  purchase_qty: '1',
  purchase_price: '',
  supplier: '',
  tax_note: '',
  notes: '',
}

function toForm(m: Material): MaterialFormState {
  return {
    name: m.name,
    description: m.description,
    category: m.category,
    unit: m.unit,
    unit_dimension: m.unit_dimension,
    purchase_qty: m.purchase_qty,
    purchase_price: m.purchase_price,
    supplier: m.supplier,
    tax_note: m.tax_note,
    notes: m.notes,
  }
}

/** Cost per unit preview: purchase_price ÷ purchase_qty, decimal-safe. */
function costPerUnitPreview(qty: string, price: string): string | null {
  try {
    if (!isDecimalString(qty) || !isDecimalString(price)) return null
    const q = new Decimal(qty)
    if (q.lte(0)) return null
    return new Decimal(price).div(q).toString()
  } catch {
    return null
  }
}

type PriceChoice = 'future' | 'recalculate' | 'snapshot'

const PRICE_CHOICES: Array<{ value: PriceChoice; label: string; detail: string }> = [
  {
    value: 'future',
    label: 'Apply to future calculations only',
    detail: 'The new price is used from now on. Existing saved snapshots are never rewritten.',
  },
  {
    value: 'recalculate',
    label: 'Recalculate affected products now',
    detail: 'After saving, recompute the unit cost of every product that uses this material and show the new figures.',
  },
  {
    value: 'snapshot',
    label: 'Preserve current costs as snapshots first',
    detail: 'Save a cost snapshot for every affected product BEFORE the price change, then apply the new price.',
  },
]

async function loadCustomUnits(): Promise<CustomUnitDef[]> {
  const raw = await api.settingsGet('pricey.customUnits')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function Materials() {
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null) // null = not open; 'new' handled separately
  const [creating, setCreating] = useState(false)
  const [historyFor, setHistoryFor] = useState<Material | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Material | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [priceChoice, setPriceChoice] = useState<PriceChoice>('future')
  const [recalcReport, setRecalcReport] = useState<{
    material: string
    rows: Array<{ product: string; unitCost: string; note?: string }>
  } | null>(null)

  const materialsQ = useAsync(() => api.materialsList(showArchived), [showArchived])
  const customUnitsQ = useAsync(loadCustomUnits, [])

  const materials = materialsQ.data ?? []
  const customUnits = customUnitsQ.data ?? []

  async function productsUsing(materialId: number): Promise<Product[]> {
    const products = await api.productsList()
    const hits: Product[] = []
    for (const p of products) {
      const full = await api.productsGetFull(p.id).catch(() => null)
      if (full && full.materials.some((l) => l.material_id === materialId)) hits.push(p)
    }
    return hits
  }

  async function handleSave(form: MaterialFormState, original: Material | null): Promise<void> {
    if (!form.name.trim()) throw new Error('A material name is required.')
    if (!form.unit.trim()) throw new Error('A unit is required.')
    if (!isDecimalString(form.purchase_qty) || new Decimal(form.purchase_qty).lte(0)) {
      throw new Error('Purchase quantity must be a number greater than zero.')
    }
    if (!isDecimalString(form.purchase_price) || new Decimal(form.purchase_price).isNegative()) {
      throw new Error('Purchase price must be a number >= 0.')
    }

    const priceChanged =
      original !== null &&
      (form.purchase_qty.trim() !== original.purchase_qty ||
        form.purchase_price.trim() !== original.purchase_price)

    const payload = {
      name: form.name.trim(),
      description: form.description,
      category: form.category,
      unit: form.unit.trim(),
      unit_dimension: form.unit_dimension,
      purchase_qty: form.purchase_qty.trim(),
      purchase_price: form.purchase_price.trim(),
      supplier: form.supplier,
      tax_note: form.tax_note,
      notes: form.notes,
    }

    if (original === null) {
      await api.materialsCreate(payload)
      setCreating(false)
      materialsQ.reload()
      return
    }

    // On a price change the user picks what happens to affected products.
    // The choice is appended to the material's notes (the price event itself
    // is recorded by the backend as "Price/qty updated"; snapshots are never
    // rewritten in any mode).
    const affected = priceChanged ? await productsUsing(original.id) : []
    if (priceChanged && priceChoice === 'snapshot') {
      const stamp = new Date().toISOString()
      for (const p of affected) {
        await api.productsSaveSnapshot(
          p.id,
          `Before ${original.name} price change (${stamp.slice(0, 10)})`,
        )
      }
    }

    let notes = form.notes
    if (priceChanged) {
      const choiceLabel = PRICE_CHOICES.find((c) => c.value === priceChoice)?.label ?? priceChoice
      const stamp = new Date().toISOString()
      const logLine = `[${stamp}] Price change choice: ${choiceLabel} (${affected.length} affected product${affected.length === 1 ? '' : 's'}).`
      notes = notes ? `${notes}\n${logLine}` : logLine
    }

    await api.materialsUpdate({ id: original.id, ...payload, notes })

    if (priceChanged && priceChoice === 'recalculate') {
      const rows: Array<{ product: string; unitCost: string; note?: string }> = []
      for (const p of affected) {
        try {
          const r = (await api.productsComputeCost(p.id)) as unknown as { totalUnitCost: string }
          rows.push({ product: p.name, unitCost: r.totalUnitCost })
        } catch (e) {
          rows.push({ product: p.name, unitCost: '—', note: errMsg(e) })
        }
      }
      setRecalcReport({ material: original.name, rows })
    } else if (priceChanged) {
      setBanner(
        `Price updated. ${affected.length} product${affected.length === 1 ? '' : 's'} use${affected.length === 1 ? 's' : ''} this material — ${priceChoice === 'snapshot' ? 'their pre-change costs were preserved as snapshots.' : 'the new price applies to future calculations.'}`,
      )
    }

    setEditing(null)
    materialsQ.reload()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Materials</h1>
        <button type="button" onClick={() => setCreating(true)}>
          New material
        </button>
      </div>

      {banner ? (
        <div className="notice notice-success mb-16">
          <strong>Saved</strong>
          <div>{banner}</div>
          <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="toolbar">
        <label className="check-row">
          <input
            type="checkbox"
            className="check"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {materialsQ.loading ? (
        <Loading />
      ) : materialsQ.error ? (
        <ErrorBanner message={materialsQ.error} onDismiss={materialsQ.reload} />
      ) : materials.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No materials yet"
            message="Materials are the ingredients, packaging and services your products are made of. Create your first material to start costing."
            action={
              <button type="button" onClick={() => setCreating(true)}>
                New material
              </button>
            }
          />
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Purchase</th>
                <th>Cost / unit</th>
                <th>Supplier</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id} style={m.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{m.name}</strong>
                    {m.archived ? <span className="pill pill-amber" style={{ marginLeft: 8 }}>archived</span> : null}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {m.unit} · {m.unit_dimension}
                    </div>
                  </td>
                  <td>
                    <span className="pill">{m.category}</span>
                  </td>
                  <td className="money">
                    <Money value={m.purchase_price} /> / {m.purchase_qty} {m.unit}
                  </td>
                  <td className="money">
                    <Money value={m.cost_per_unit} /> / {m.unit}
                  </td>
                  <td>{m.supplier || '—'}</td>
                  <td>{fmtDate(m.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link-btn" onClick={() => setHistoryFor(m)}>
                        Price history
                      </button>
                      <button type="button" className="link-btn" onClick={() => { setPriceChoice('future'); setEditing(m) }}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => setConfirmDelete(m)}
                      >
                        {m.archived ? 'Delete' : 'Archive'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <MaterialModal
          title="New material"
          initial={emptyForm}
          customUnits={customUnits}
          showPriceChoice={false}
          priceChoice={priceChoice}
          onPriceChoice={setPriceChoice}
          onClose={() => setCreating(false)}
          onSave={(f) => handleSave(f, null)}
        />
      ) : null}

      {editing ? (
        <MaterialModal
          title={`Edit material — ${editing.name}`}
          initial={toForm(editing)}
          customUnits={customUnits}
          showPriceChoice
          priceChoice={priceChoice}
          onPriceChoice={setPriceChoice}
          onClose={() => setEditing(null)}
          onSave={(f) => handleSave(f, editing)}
        />
      ) : null}

      {historyFor ? (
        <PriceHistoryModal material={historyFor} onClose={() => setHistoryFor(null)} />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={confirmDelete.archived ? 'Delete material permanently?' : 'Archive material?'}
          message={
            confirmDelete.archived ? (
              <>
                <p>
                  <strong>{confirmDelete.name}</strong> will be permanently deleted. Products that
                  reference it will no longer be able to compute their cost until the line is
                  removed.
                </p>
                <p className="muted">Archived materials are hidden but kept for history.</p>
              </>
            ) : (
              <p>
                <strong>{confirmDelete.name}</strong> will be archived. It stays in history and
                price events, but is hidden from pickers.
              </p>
            )
          }
          confirmLabel={confirmDelete.archived ? 'Delete permanently' : 'Archive'}
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              if (confirmDelete.archived) await api.materialsDelete(confirmDelete.id)
              else await api.materialsArchive(confirmDelete.id)
              setConfirmDelete(null)
              materialsQ.reload()
            } catch (e) {
              setBanner(`Could not ${confirmDelete.archived ? 'delete' : 'archive'}: ${errMsg(e)}`)
              setConfirmDelete(null)
            }
          }}
        />
      ) : null}

      {recalcReport ? (
        <Modal
          title={`Recalculated costs — ${recalcReport.material}`}
          onClose={() => setRecalcReport(null)}
          footer={
            <button type="button" className="secondary" onClick={() => setRecalcReport(null)}>
              Close
            </button>
          }
        >
          <p className="muted">
            Unit costs recomputed with the new material price. Saved snapshots were not modified.
          </p>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>New unit cost</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {recalcReport.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.product}</td>
                  <td className="money">
                    {r.unitCost === '—' ? '—' : <Money value={r.unitCost} />}
                  </td>
                  <td className="muted">{r.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}
    </div>
  )
}

function MaterialModal({
  title,
  initial,
  customUnits,
  showPriceChoice,
  priceChoice,
  onPriceChoice,
  onClose,
  onSave,
}: {
  title: string
  initial: MaterialFormState
  customUnits: CustomUnitDef[]
  showPriceChoice: boolean
  priceChoice: PriceChoice
  onPriceChoice: (c: PriceChoice) => void
  onClose: () => void
  onSave: (f: MaterialFormState) => Promise<void>
}) {
  const [form, setForm] = useState<MaterialFormState>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (k: keyof MaterialFormState, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const preview = costPerUnitPreview(form.purchase_qty, form.purchase_price)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch (e) {
      setError(errMsg(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save material'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="form-grid">
        <Field label="Name">
          <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Category">
          <Select
            value={form.category}
            onChange={(v) => set('category', v)}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
        </Field>
      </div>
      <Field label="Description">
        <TextInput value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Unit" hint="The unit the cost-per-unit is denominated in.">
          <UnitSelect value={form.unit} onChange={(v) => set('unit', v)} customUnits={customUnits} />
        </Field>
        <Field label="Unit dimension">
          <Select
            value={form.unit_dimension}
            onChange={(v) => set('unit_dimension', v)}
            options={DIMENSIONS.map((d) => ({ value: d, label: d }))}
          />
        </Field>
        <Field label="Purchase quantity" hint="How much you get per purchase.">
          <NumberInput value={form.purchase_qty} onChange={(v) => set('purchase_qty', v)} />
        </Field>
        <Field label="Purchase price" hint="What you pay per purchase.">
          <NumberInput value={form.purchase_price} onChange={(v) => set('purchase_price', v)} />
        </Field>
      </div>
      <div className="notice">
        <strong>Cost per unit</strong>
        <div className="money" style={{ fontSize: 18 }}>
          {preview !== null ? (
            <>
              <Money value={preview} /> / {form.unit || 'unit'}
            </>
          ) : (
            <span className="muted">Enter a purchase quantity and price to preview.</span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          purchase price ÷ purchase quantity, computed with decimal arithmetic.
        </div>
      </div>
      <div className="form-grid">
        <Field label="Supplier">
          <TextInput value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
        </Field>
        <Field label="Tax note">
          <TextInput value={form.tax_note} onChange={(e) => set('tax_note', e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      {showPriceChoice ? (
        <div>
          <div className="section-title" style={{ fontSize: 16 }}>
            If the price or quantity changed…
          </div>
          <p className="muted">
            Changing the purchase price or quantity records a price event. Choose what happens to
            the products that use this material. Saved snapshots are never rewritten, in any mode.
          </p>
          {PRICE_CHOICES.map((c) => (
            <label key={c.value} className="check-row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
              <input
                type="radio"
                className="check"
                name="price-choice"
                checked={priceChoice === c.value}
                onChange={() => onPriceChoice(c.value)}
              />
              <span>
                <strong>{c.label}</strong>
                <br />
                <span className="muted">{c.detail}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </Modal>
  )
}

function PriceHistoryModal({ material, onClose }: { material: Material; onClose: () => void }) {
  const eventsQ = useAsync(() => api.materialsPriceEvents(material.id), [material.id])
  const events = eventsQ.data ?? []

  return (
    <Modal
      title={`Price history — ${material.name}`}
      onClose={onClose}
      wide
      footer={
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      {eventsQ.loading ? (
        <Loading />
      ) : eventsQ.error ? (
        <ErrorBanner message={eventsQ.error} />
      ) : events.length === 0 ? (
        <EmptyState
          title="No price events"
          message="The price has never changed since this material was created."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Effective</th>
              <th>Purchase price</th>
              <th>Quantity</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e: MaterialPriceEvent) => (
              <tr key={e.id}>
                <td>{fmtDate(e.effective_at)}</td>
                <td className="money">
                  <Money value={e.purchase_price} />
                </td>
                <td>
                  {e.purchase_qty} {material.unit}
                </td>
                <td className="muted">{e.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {material.notes ? (
        <div className="mt-16">
          <div className="section-title" style={{ fontSize: 16 }}>
            Change log
          </div>
          <pre
            className="muted"
            style={{ whiteSpace: 'pre-wrap', fontSize: 12, fontFamily: 'inherit' }}
          >
            {material.notes}
          </pre>
        </div>
      ) : null}
    </Modal>
  )
}
