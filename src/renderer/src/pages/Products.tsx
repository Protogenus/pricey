import { useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { EmptyState } from '../components/EmptyState.js'
import { ExplainView } from '../components/ExplainView.js'
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
import { explainCost, type ExplainStep } from '../../../engine/explain.js'
import { canConvert, type CustomUnitDef } from '../../../engine/units.js'
import type {
  ID,
  LaborMode,
  LaborRole,
  Material,
  OverheadItem,
  OverheadMethod,
  Product,
  ProductComponentLine,
  ProductFull,
  ProductLaborLine,
  ProductMaterialLine,
  ProductOtherCostLine,
  ProductOverheadLine,
} from '../../../shared/types.js'
import type { ProductCostResult, TraceLine } from '../../../engine/costing.js'

const LABOR_MODES: LaborMode[] = ['hourly', 'per_minute', 'per_unit', 'fixed']
const OVERHEAD_METHODS: OverheadMethod[] = [
  'per_unit',
  'per_batch',
  'pct_of_direct',
  'per_hour',
  'monthly_share',
]

const LABOR_MODE_LABEL: Record<LaborMode, string> = {
  hourly: 'Hourly — rate × minutes ÷ 60',
  per_minute: 'Per minute — rate × minutes',
  per_unit: 'Per unit — rate × units',
  fixed: 'Fixed charge per unit',
}

const OVERHEAD_METHOD_LABEL: Record<OverheadMethod, string> = {
  per_unit: 'Per unit — amount added to each unit',
  per_batch: 'Per batch — amount ÷ batch size',
  pct_of_direct: '% of direct cost — fraction × direct cost',
  per_hour: 'Per labor hour — hours × linked item hourly rate',
  monthly_share: 'Monthly share — share × linked item monthly amount ÷ batch size',
}

interface ProductFormState {
  name: string
  sku: string
  description: string
  category: string
  unit_of_sale: string
  batch_size: string
  waste_pct: string
  defect_pct: string
  notes: string
  is_component: boolean
}

const emptyProductForm = (componentOnly: boolean): ProductFormState => ({
  name: '',
  sku: '',
  description: '',
  category: '',
  unit_of_sale: 'piece',
  batch_size: '1',
  waste_pct: '0',
  defect_pct: '0',
  notes: '',
  is_component: componentOnly,
})

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

export default function Products({ componentOnly = false }: { componentOnly?: boolean }) {
  const title = componentOnly ? 'Components' : 'Products'
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null)
  const q = useAsync(() => api.productsList(false), [])

  const all = q.data ?? []
  const products = componentOnly ? all.filter((p) => p.is_component === 1) : all

  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <button type="button" onClick={() => setCreating(true)}>
          New {componentOnly ? 'component' : 'product'}
        </button>
      </div>

      {selectedId === null ? (
        <>
          {componentOnly ? (
            <p className="muted">
              Components are products flagged as reusable subassemblies. They are costed like any
              product and can be nested inside other products' bills of materials.
            </p>
          ) : null}
          {q.loading ? (
            <Loading />
          ) : q.error ? (
            <ErrorBanner message={q.error} onDismiss={q.reload} />
          ) : products.length === 0 ? (
            <div className="card">
              <EmptyState
                title={componentOnly ? 'No components yet' : 'No products yet'}
                message={
                  componentOnly
                    ? 'Create your first reusable component — a subassembly other products can include.'
                    : 'Create your first product to start costing.'
                }
                action={
                  <button type="button" onClick={() => setCreating(true)}>
                    New {componentOnly ? 'component' : 'product'}
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
                    <th>SKU</th>
                    <th>Category</th>
                    <th>Batch size</th>
                    <th>Unit of sale</th>
                    {componentOnly ? null : <th>Component?</th>}
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => setSelectedId(p.id)}>
                          <strong>{p.name}</strong>
                        </button>
                      </td>
                      <td>{p.sku || '—'}</td>
                      <td>{p.category || '—'}</td>
                      <td>{p.batch_size}</td>
                      <td>{p.unit_of_sale || '—'}</td>
                      {componentOnly ? null : (
                        <td>{p.is_component === 1 ? <span className="pill pill-sky">component</span> : '—'}</td>
                      )}
                      <td>{fmtDate(p.updated_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="link-btn" onClick={() => setEditing(p)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="link-btn danger"
                            onClick={() => setConfirmDelete(p)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <ProductDetail
          productId={selectedId}
          onBack={() => {
            setSelectedId(null)
            q.reload()
          }}
        />
      )}

      {creating ? (
        <ProductModal
          title={componentOnly ? 'New component' : 'New product'}
          initial={emptyProductForm(componentOnly)}
          componentOnly={componentOnly}
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false)
            q.reload()
            setSelectedId(p.id)
          }}
        />
      ) : null}

      {editing ? (
        <ProductModal
          title={`Edit — ${editing.name}`}
          initial={{
            name: editing.name,
            sku: editing.sku,
            description: editing.description,
            category: editing.category,
            unit_of_sale: editing.unit_of_sale,
            batch_size: String(editing.batch_size),
            waste_pct: editing.waste_pct,
            defect_pct: editing.defect_pct,
            notes: editing.notes,
            is_component: editing.is_component === 1,
          }}
          componentOnly={componentOnly}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            q.reload()
          }}
          productId={editing.id}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete product permanently?"
          message={
            <p>
              <strong>{confirmDelete.name}</strong> and all of its cost lines will be permanently
              deleted. Saved snapshots keep their frozen copies. Products using it as a component
              will fail to compute until the component line is removed.
            </p>
          }
          confirmLabel="Delete permanently"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await api.productsDelete(confirmDelete.id)
            } catch (e) {
              alert(errMsg(e))
            }
            setConfirmDelete(null)
            q.reload()
          }}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Product create/edit modal                                           */
/* ------------------------------------------------------------------ */

function ProductModal({
  title,
  initial,
  productId,
  componentOnly,
  onClose,
  onSaved,
}: {
  title: string
  initial: ProductFormState
  productId?: ID
  componentOnly: boolean
  onClose: () => void
  onSaved: (p: Product) => void
}) {
  const [form, setForm] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof ProductFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }))

  function validate(): string | null {
    if (!form.name.trim()) return 'A product name is required.'
    if (!isDecimalString(form.batch_size) || new Decimal(form.batch_size).lte(0))
      return 'Batch size must be a number greater than zero.'
    for (const [k, label] of [
      ['waste_pct', 'Waste %'],
      ['defect_pct', 'Defect %'],
    ] as const) {
      const v = form[k]
      if (v.trim() !== '') {
        if (!isDecimalString(v)) return `${label} must be a number.`
        const d = new Decimal(v)
        if (d.isNegative() || d.gte(1)) return `${label} must be in the range [0, 1) — e.g. 0.05 for 5%.`
      }
    }
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
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku,
        description: form.description,
        category: form.category,
        unit_of_sale: form.unit_of_sale,
        batch_size: Number(form.batch_size),
        waste_pct: form.waste_pct.trim() || '0',
        defect_pct: form.defect_pct.trim() || '0',
        notes: form.notes,
        is_component: componentOnly ? true : form.is_component,
      }
      const saved =
        productId === undefined
          ? await api.productsCreate(payload)
          : await api.productsUpdate({ id: productId, ...payload })
      onSaved(saved)
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
            {saving ? 'Saving…' : 'Save product'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="form-grid">
        <Field label="Name">
          <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="SKU">
          <TextInput value={form.sku} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Category">
          <TextInput value={form.category} onChange={(e) => set('category', e.target.value)} />
        </Field>
        <Field label="Unit of sale">
          <TextInput value={form.unit_of_sale} onChange={(e) => set('unit_of_sale', e.target.value)} />
        </Field>
        <Field label="Batch size" hint="Units produced per batch. Must be > 0.">
          <NumberInput value={form.batch_size} onChange={(v) => set('batch_size', v)} />
        </Field>
        <Field
          label="Waste % (0..1)"
          hint="Applied once to the whole material subtotal. 0.05 = 5%."
        >
          <NumberInput value={form.waste_pct} onChange={(v) => set('waste_pct', v)} />
        </Field>
        <Field label="Defect % (0..1)" hint="Fraction of units unusable. 0.02 = 2%.">
          <NumberInput value={form.defect_pct} onChange={(v) => set('defect_pct', v)} />
        </Field>
        {!componentOnly ? (
          <Field label="Reusable component?">
            <label className="check-row">
              <input
                type="checkbox"
                className="check"
                checked={form.is_component}
                onChange={(e) => set('is_component', e.target.checked)}
              />
              Flag as a component other products can include
            </label>
          </Field>
        ) : null}
      </div>
      <Field label="Description">
        <TextInput value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="Notes">
        <TextArea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Product detail: line editors + cost breakdown                        */
/* ------------------------------------------------------------------ */

interface DetailData {
  full: ProductFull
  materials: Material[]
  roles: LaborRole[]
  overheadItems: OverheadItem[]
  components: Product[]
  customUnits: CustomUnitDef[]
}

async function loadDetail(productId: ID): Promise<DetailData> {
  const [full, materials, roles, overheadItems, products, customUnits] = await Promise.all([
    api.productsGetFull(productId),
    api.materialsList(false),
    api.laborList(false),
    api.overheadList(false),
    api.productsList(false),
    loadCustomUnits(),
  ])
  return {
    full,
    materials,
    roles,
    overheadItems,
    components: products.filter((p) => p.is_component === 1),
    customUnits,
  }
}

function ProductDetail({
  productId,
  onBack,
}: {
  productId: ID
  onBack: () => void
}) {
  const q = useAsync(() => loadDetail(productId), [productId])
  const [lineModal, setLineModal] = useState<
    | { kind: 'material'; line?: ProductMaterialLine }
    | { kind: 'labor'; line?: ProductLaborLine }
    | { kind: 'overhead'; line?: ProductOverheadLine }
    | { kind: 'component'; line?: ProductComponentLine }
    | { kind: 'other'; line?: ProductOtherCostLine }
    | null
  >(null)
  const [confirmRemove, setConfirmRemove] = useState<{
    label: string
    run: () => Promise<void>
  } | null>(null)

  const d = q.data

  async function removeLine(label: string, run: () => Promise<void>) {
    setConfirmRemove({ label, run })
  }

  async function doRemove() {
    if (!confirmRemove) return
    try {
      await confirmRemove.run()
      q.reload()
    } catch (e) {
      alert(errMsg(e))
    }
    setConfirmRemove(null)
  }

  async function cycleCheck(candidateId: ID, productName: string): Promise<string | null> {
    // Block self-reference outright, then walk the candidate's component tree.
    if (candidateId === productId) {
      return `"${productName}" cannot contain itself as a component.`
    }
    const seen = new Set<ID>()
    const stack: ID[] = [candidateId]
    let depth = 0
    while (stack.length > 0 && depth < 25) {
      depth += 1
      const id = stack.pop() as ID
      if (seen.has(id)) continue
      seen.add(id)
      if (id === productId) {
        return (
          `Adding "${productName}" would create a circular component reference — ` +
          `it already contains this product through a component chain. Circular references are rejected, not recursed.`
        )
      }
      try {
        const f = await api.productsGetFull(id)
        for (const c of f.components) stack.push(c.component_id)
      } catch {
        // Unloadable component: the backend will report it on compute.
      }
    }
    return null
  }

  return (
    <div>
      <div className="toolbar">
        <button type="button" className="secondary" onClick={onBack}>
          ← Back to list
        </button>
      </div>

      {q.loading ? (
        <Loading />
      ) : q.error || !d ? (
        <ErrorBanner message={q.error ?? 'Failed to load.'} onDismiss={q.reload} />
      ) : (
        <>
          <div className="card mb-16">
            <div className="page-head" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{d.full.name}</h2>
              {d.full.is_component === 1 ? <span className="pill pill-sky">component</span> : null}
            </div>
            <dl className="kv">
              <dt>SKU</dt>
              <dd>{d.full.sku || '—'}</dd>
              <dt>Category</dt>
              <dd>{d.full.category || '—'}</dd>
              <dt>Unit of sale</dt>
              <dd>{d.full.unit_of_sale || '—'}</dd>
              <dt>Batch size</dt>
              <dd>{d.full.batch_size}</dd>
              <dt>Waste / defect</dt>
              <dd>
                {(Number(d.full.waste_pct) * 100).toFixed(2)}% /{' '}
                {(Number(d.full.defect_pct) * 100).toFixed(2)}%
              </dd>
              {d.full.description ? (
                <>
                  <dt>Description</dt>
                  <dd>{d.full.description}</dd>
                </>
              ) : null}
              {d.full.notes ? (
                <>
                  <dt>Notes</dt>
                  <dd>{d.full.notes}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <LineSection
            title="Materials"
            empty="No material lines yet — add the ingredients, packaging or services this product uses."
            addLabel="Add material"
            onAdd={() => setLineModal({ kind: 'material' })}
          >
            {d.full.materials.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Qty / unit</th>
                    <th>Unit</th>
                    <th>Line waste</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.full.materials.map((l) => (
                    <tr key={l.id}>
                      <td>{l.material_name ?? `#${l.material_id}`}</td>
                      <td>{l.quantity}</td>
                      <td>{l.unit}</td>
                      <td>{(Number(l.waste_pct) * 100).toFixed(2)}%</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setLineModal({ kind: 'material', line: l })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="link-btn danger"
                            onClick={() =>
                              removeLine(`material line "${l.material_name}"`, () =>
                                api.productsRemoveMaterialLine(l.id),
                              )
                            }
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
          </LineSection>

          <LineSection
            title="Labor"
            empty="No labor lines yet."
            addLabel="Add labor"
            onAdd={() => setLineModal({ kind: 'labor' })}
          >
            {d.full.labor.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Mode</th>
                    <th>Rate</th>
                    <th>Quantity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.full.labor.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.task_name || l.role_name || 'Labor'}
                        {l.role_name ? <span className="muted"> ({l.role_name})</span> : null}
                      </td>
                      <td>{l.mode}</td>
                      <td className="money">
                        <Money value={l.rate} />
                      </td>
                      <td>{l.quantity}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setLineModal({ kind: 'labor', line: l })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="link-btn danger"
                            onClick={() =>
                              removeLine(`labor line "${l.task_name || l.role_name}"`, () =>
                                api.productsRemoveLaborLine(l.id),
                              )
                            }
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
          </LineSection>

          <LineSection
            title="Overhead"
            empty="No overhead lines yet."
            addLabel="Add overhead"
            onAdd={() => setLineModal({ kind: 'overhead' })}
          >
            {d.full.overhead.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Method</th>
                    <th>Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.full.overhead.map((l) => (
                    <tr key={l.id}>
                      <td>{l.item_name ?? 'Custom'}</td>
                      <td>{l.method}</td>
                      <td>{l.value}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setLineModal({ kind: 'overhead', line: l })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="link-btn danger"
                            onClick={() =>
                              removeLine(`overhead line "${l.item_name ?? l.method}"`, () =>
                                api.productsRemoveOverheadLine(l.id),
                              )
                            }
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
          </LineSection>

          <LineSection
            title="Components"
            empty="No component lines yet — nest reusable subassemblies here."
            addLabel="Add component"
            onAdd={() => setLineModal({ kind: 'component' })}
          >
            {d.full.components.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Quantity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.full.components.map((l) => (
                    <tr key={l.id}>
                      <td>{l.component_name ?? `#${l.component_id}`}</td>
                      <td>{l.quantity}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setLineModal({ kind: 'component', line: l })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="link-btn danger"
                            onClick={() =>
                              removeLine(`component "${l.component_name}"`, () =>
                                api.productsRemoveComponentLine(l.id),
                              )
                            }
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
          </LineSection>

          <LineSection
            title="Other costs"
            empty="No other costs yet."
            addLabel="Add other cost"
            onAdd={() => setLineModal({ kind: 'other' })}
          >
            {d.full.other_costs.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Amount / unit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.full.other_costs.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="money">
                        <Money value={l.amount_per_unit} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setLineModal({ kind: 'other', line: l })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="link-btn danger"
                            onClick={() =>
                              removeLine(`other cost "${l.name}"`, () =>
                                api.productsRemoveOtherCostLine(l.id),
                              )
                            }
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
          </LineSection>

          <CostBreakdown productId={productId} />
        </>
      )}

      {lineModal && d ? (
        <LineModal
          modal={lineModal}
          data={d}
          productId={productId}
          cycleCheck={cycleCheck}
          onClose={() => setLineModal(null)}
          onSaved={() => {
            setLineModal(null)
            q.reload()
          }}
        />
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          title="Remove line?"
          message={<p>Remove {confirmRemove.label}? This cannot be undone.</p>}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={doRemove}
        />
      ) : null}
    </div>
  )
}

function LineSection({
  title,
  empty,
  addLabel,
  onAdd,
  children,
}: {
  title: string
  empty: string
  addLabel: string
  onAdd: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card mb-16">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {title}
        </div>
        <button type="button" className="secondary" onClick={onAdd}>
          {addLabel}
        </button>
      </div>
      {children ?? <p className="muted">{empty}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Line modals                                                         */
/* ------------------------------------------------------------------ */

type LineModalKind =
  | { kind: 'material'; line?: ProductMaterialLine }
  | { kind: 'labor'; line?: ProductLaborLine }
  | { kind: 'overhead'; line?: ProductOverheadLine }
  | { kind: 'component'; line?: ProductComponentLine }
  | { kind: 'other'; line?: ProductOtherCostLine }

function LineModal({
  modal,
  data,
  productId,
  cycleCheck,
  onClose,
  onSaved,
}: {
  modal: LineModalKind
  data: DetailData
  productId: ID
  cycleCheck: (candidateId: ID, name: string) => Promise<string | null>
  onClose: () => void
  onSaved: () => void
}) {
  // Dispatch to the per-kind editor.
  const m = modal
  switch (m.kind) {
    case 'material':
      return <MaterialLineModal data={data} productId={productId} line={m.line} onClose={onClose} onSaved={onSaved} />
    case 'labor':
      return <LaborLineModal data={data} productId={productId} line={m.line} onClose={onClose} onSaved={onSaved} />
    case 'overhead':
      return <OverheadLineModal data={data} productId={productId} line={m.line} onClose={onClose} onSaved={onSaved} />
    case 'component':
      return <ComponentLineModal data={data} productId={productId} line={m.line} cycleCheck={cycleCheck} onClose={onClose} onSaved={onSaved} />
    case 'other':
      return <OtherCostModal productId={productId} line={m.line} onClose={onClose} onSaved={onSaved} />
  }
}

function useLineSave(onSaved: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  async function run(fn: () => Promise<unknown>) {
    setSaving(true)
    setError(null)
    try {
      await fn()
      onSaved()
    } catch (e) {
      setError(errMsg(e))
      setSaving(false)
    }
  }
  return { error, saving, run, setError }
}

function MaterialLineModal({
  data,
  productId,
  line,
  onClose,
  onSaved,
}: {
  data: DetailData
  productId: ID
  line?: ProductMaterialLine
  onClose: () => void
  onSaved: () => void
}) {
  const [materialId, setMaterialId] = useState(String(line?.material_id ?? data.materials[0]?.id ?? ''))
  const [quantity, setQuantity] = useState(line?.quantity ?? '')
  const [unit, setUnit] = useState(line?.unit ?? data.materials[0]?.unit ?? 'piece')
  const [waste, setWaste] = useState(line?.waste_pct ?? '0')
  const { error, saving, run } = useLineSave(onSaved)

  const material = data.materials.find((m) => String(m.id) === materialId)
  const compatible = material ? canConvert(unit, material.unit, data.customUnits) : true

  async function save() {
    if (!material) throw new Error('Pick a material.')
    if (!isDecimalString(quantity) || new Decimal(quantity).isNegative())
      throw new Error('Quantity must be a number >= 0.')
    if (waste.trim() !== '') {
      if (!isDecimalString(waste)) throw new Error('Line waste must be a number.')
      const w = new Decimal(waste)
      if (w.isNegative() || w.gte(1)) throw new Error('Line waste must be in [0, 1).')
    }
    if (!compatible) {
      throw new Error(
        `Cannot convert ${unit} to ${material.unit} — the units are in different dimensions. ` +
          `Pick a compatible unit or register a custom unit in Settings.`,
      )
    }
    const payload = {
      material_id: material.id,
      quantity: quantity.trim() || '0',
      unit,
      waste_pct: waste.trim() || '0',
    }
    await run(() =>
      line
        ? api.productsUpdateMaterialLine({ id: line.id, ...payload })
        : api.productsAddMaterial(productId, payload),
    )
  }

  return (
    <Modal
      title={line ? 'Edit material line' : 'Add material line'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save line'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field label="Material">
        <Select
          value={materialId}
          onChange={(v) => {
            setMaterialId(v)
            const m = data.materials.find((x) => String(x.id) === v)
            if (m) setUnit(m.unit)
          }}
          options={data.materials.map((m) => ({
            value: String(m.id),
            label: `${m.name} — ${m.cost_per_unit}/${m.unit}`,
          }))}
        />
      </Field>
      <div className="form-grid">
        <Field label="Quantity per unit of product">
          <NumberInput value={quantity} onChange={setQuantity} />
        </Field>
        <Field label="Unit" hint={material ? `Material is costed per ${material.unit}.` : undefined}>
          <UnitSelect value={unit} onChange={setUnit} customUnits={data.customUnits} />
        </Field>
        <Field label="Line waste (0..1)" hint="Extra allowance for this usage, e.g. 0.05.">
          <NumberInput value={waste} onChange={setWaste} />
        </Field>
      </div>
      {!compatible && material ? (
        <div className="notice notice-danger">
          <strong>Incompatible units</strong>
          <div>
            {unit} cannot be converted to {material.unit}. The cost engine refuses cross-dimension
            conversions — pick a compatible unit or register a custom unit in Settings.
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

function LaborLineModal({
  data,
  productId,
  line,
  onClose,
  onSaved,
}: {
  data: DetailData
  productId: ID
  line?: ProductLaborLine
  onClose: () => void
  onSaved: () => void
}) {
  const [roleId, setRoleId] = useState(
    line ? (line.role_id === null ? '' : String(line.role_id)) : '',
  )
  const [taskName, setTaskName] = useState(line?.task_name ?? '')
  const [mode, setMode] = useState<LaborMode>(line?.mode ?? 'hourly')
  const [rate, setRate] = useState(line?.rate ?? '')
  const [quantity, setQuantity] = useState(line?.quantity ?? '')
  const { error, saving, run } = useLineSave(onSaved)

  const role = data.roles.find((r) => String(r.id) === roleId)
  const qtyLabel =
    mode === 'hourly' || mode === 'per_minute' ? 'Minutes' : mode === 'per_unit' ? 'Units' : '—'
  const rateLabel =
    mode === 'hourly'
      ? 'Rate ($/hour)'
      : mode === 'per_minute'
        ? 'Rate ($/minute)'
        : mode === 'per_unit'
          ? 'Rate ($/unit)'
          : 'Fixed charge ($)'

  async function save() {
    if (!isDecimalString(rate) || new Decimal(rate).isNegative())
      throw new Error('Rate must be a number >= 0.')
    if (mode !== 'fixed') {
      if (!isDecimalString(quantity) || new Decimal(quantity).isNegative())
        throw new Error('Quantity must be a number >= 0.')
    }
    const payload = {
      role_id: roleId === '' ? null : Number(roleId),
      task_name: taskName,
      mode,
      rate: rate.trim() || '0',
      quantity: mode === 'fixed' ? '0' : quantity.trim() || '0',
    }
    await run(() =>
      line
        ? api.productsUpdateLaborLine({ id: line.id, ...payload })
        : api.productsAddLabor(productId, payload),
    )
  }

  return (
    <Modal
      title={line ? 'Edit labor line' : 'Add labor line'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save line'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="form-grid">
        <Field label="Role (optional)" hint="Leave empty for a custom one-off task.">
          <Select
            value={roleId}
            onChange={setRoleId}
            options={[
              { value: '', label: 'Custom (no role)' },
              ...data.roles.map((r) => ({
                value: String(r.id),
                label: `${r.name} — ${r.rate_per_hour}/hr`,
              })),
            ]}
          />
        </Field>
        <Field label="Task name">
          <TextInput value={taskName} onChange={(e) => setTaskName(e.target.value)} />
        </Field>
      </div>
      <Field label="Mode">
        <Select
          value={mode}
          onChange={(v) => setMode(v as LaborMode)}
          options={LABOR_MODES.map((m) => ({ value: m, label: LABOR_MODE_LABEL[m] }))}
        />
      </Field>
      <div className="form-grid">
        <Field
          label={rateLabel}
          hint={
            role && (rate.trim() === '' || rate.trim() === '0')
              ? `Empty rate falls back to the role's ${role.rate_per_hour}/hr.`
              : undefined
          }
        >
          <NumberInput value={rate} onChange={setRate} />
        </Field>
        <Field label={qtyLabel} hint={mode === 'fixed' ? 'Not used for fixed charges.' : undefined}>
          <NumberInput value={quantity} onChange={setQuantity} disabled={mode === 'fixed'} />
        </Field>
      </div>
    </Modal>
  )
}

function OverheadLineModal({
  data,
  productId,
  line,
  onClose,
  onSaved,
}: {
  data: DetailData
  productId: ID
  line?: ProductOverheadLine
  onClose: () => void
  onSaved: () => void
}) {
  const [itemId, setItemId] = useState(
    line ? (line.overhead_item_id === null ? '' : String(line.overhead_item_id)) : '',
  )
  const [method, setMethod] = useState<OverheadMethod>(line?.method ?? 'per_unit')
  const [value, setValue] = useState(line?.value ?? '')
  const { error, saving, run } = useLineSave(onSaved)

  const needsItem = method === 'per_hour' || method === 'monthly_share'
  const item = data.overheadItems.find((i) => String(i.id) === itemId)

  async function save() {
    if (needsItem && itemId === '') {
      throw new Error(
        `The "${method}" method needs a linked overhead item — its amount is used as the ${
          method === 'per_hour' ? 'hourly rate' : 'monthly amount'
        }.`,
      )
    }
    if (!isDecimalString(value) || new Decimal(value).isNegative())
      throw new Error('Value must be a number >= 0.')
    if (method === 'pct_of_direct' && new Decimal(value).gte(1))
      throw new Error('A % of direct cost must be below 1 (e.g. 0.1 for 10%).')
    if (method === 'monthly_share' && new Decimal(value).gte(1))
      throw new Error('Monthly share must be below 1 (e.g. 0.25 for a quarter).')
    const payload = {
      overhead_item_id: itemId === '' ? null : Number(itemId),
      method,
      value: value.trim() || '0',
    }
    await run(() =>
      line
        ? api.productsUpdateOverheadLine({ id: line.id, ...payload })
        : api.productsAddOverhead(productId, payload),
    )
  }

  return (
    <Modal
      title={line ? 'Edit overhead line' : 'Add overhead line'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save line'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field
        label="Overhead item"
        hint={
          needsItem
            ? `Required: the item's amount is used as the ${method === 'per_hour' ? 'hourly rate' : 'monthly amount'}.`
            : 'Optional — link an item to name the line after it.'
        }
      >
        <Select
          value={itemId}
          onChange={setItemId}
          options={[
            { value: '', label: 'Custom (no item)' },
            ...data.overheadItems.map((i) => ({
              value: String(i.id),
              label: `${i.name} — ${i.amount}${i.period ? `/${i.period}` : ''}`,
            })),
          ]}
        />
      </Field>
      <Field label="Allocation method">
        <Select
          value={method}
          onChange={(v) => setMethod(v as OverheadMethod)}
          options={OVERHEAD_METHODS.map((m) => ({ value: m, label: OVERHEAD_METHOD_LABEL[m] }))}
        />
      </Field>
      <Field
        label="Value"
        hint={
          method === 'per_unit'
            ? 'Currency amount added to each unit.'
            : method === 'per_batch'
              ? 'Currency amount per batch (divided by batch size).'
              : method === 'pct_of_direct'
                ? 'Fraction of direct cost, e.g. 0.1 for 10%.'
                : method === 'per_hour'
                  ? `Labor hours per unit${item ? ` × ${item.amount}/hr` : ''}.`
                  : `Share of the monthly amount${item ? ` (${item.amount})` : ''}, e.g. 0.25. Monthly units = batch size.`
        }
      >
        <NumberInput value={value} onChange={setValue} />
      </Field>
    </Modal>
  )
}

function ComponentLineModal({
  data,
  productId,
  line,
  cycleCheck,
  onClose,
  onSaved,
}: {
  data: DetailData
  productId: ID
  line?: ProductComponentLine
  cycleCheck: (candidateId: ID, name: string) => Promise<string | null>
  onClose: () => void
  onSaved: () => void
}) {
  const [componentId, setComponentId] = useState(
    String(line?.component_id ?? data.components[0]?.id ?? ''),
  )
  const [quantity, setQuantity] = useState(line?.quantity ?? '1')
  const [checking, setChecking] = useState(false)
  const { error, saving, run, setError } = useLineSave(onSaved)

  async function save() {
    if (componentId === '') throw new Error('Pick a component product.')
    if (!isDecimalString(quantity) || !new Decimal(quantity).gt(0))
      throw new Error('Quantity must be a number greater than zero.')
    const candidate = data.components.find((c) => String(c.id) === componentId)
    setChecking(true)
    try {
      const problem = await cycleCheck(Number(componentId), candidate?.name ?? `#${componentId}`)
      if (problem) {
        setError(problem)
        setChecking(false)
        return
      }
    } catch (e) {
      setError(errMsg(e))
      setChecking(false)
      return
    }
    setChecking(false)
    const payload = { component_id: Number(componentId), quantity: quantity.trim() || '1' }
    await run(() =>
      line
        ? api.productsUpdateComponentLine({ id: line.id, ...payload })
        : api.productsAddComponent(productId, payload),
    )
  }

  return (
    <Modal
      title={line ? 'Edit component line' : 'Add component line'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving || checking}>
            {saving || checking ? 'Checking…' : 'Save line'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      {data.components.length === 0 ? (
        <EmptyState
          title="No components exist"
          message="Flag a product as a reusable component first, then nest it here."
        />
      ) : (
        <>
          <Field label="Component product">
            <Select
              value={componentId}
              onChange={setComponentId}
              options={data.components
                .filter((c) => c.id !== productId)
                .map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </Field>
          <Field label="Quantity" hint="Units of the component per unit of this product.">
            <NumberInput value={quantity} onChange={setQuantity} />
          </Field>
          <p className="muted">
            Self-references and circular chains are blocked — the cost engine rejects cycles
            instead of recursing forever.
          </p>
        </>
      )}
    </Modal>
  )
}

function OtherCostModal({
  productId,
  line,
  onClose,
  onSaved,
}: {
  productId: ID
  line?: ProductOtherCostLine
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(line?.name ?? '')
  const [amount, setAmount] = useState(line?.amount_per_unit ?? '')
  const { error, saving, run } = useLineSave(onSaved)

  async function save() {
    if (!name.trim()) throw new Error('A name is required.')
    if (!isDecimalString(amount) || new Decimal(amount).isNegative())
      throw new Error('Amount must be a number >= 0.')
    const payload = { name: name.trim(), amount_per_unit: amount.trim() || '0' }
    await run(() =>
      line
        ? api.productsUpdateOtherCostLine({ id: line.id, ...payload })
        : api.productsAddOtherCost(productId, payload),
    )
  }

  return (
    <Modal
      title={line ? 'Edit other cost' : 'Add other cost'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save line'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Amount per unit">
        <NumberInput value={amount} onChange={setAmount} />
      </Field>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Cost breakdown                                                      */
/* ------------------------------------------------------------------ */

function asCostResult(r: unknown): ProductCostResult {
  return r as ProductCostResult
}

function CostBreakdown({ productId }: { productId: ID }) {
  const [result, setResult] = useState<ProductCostResult | null>(null)
  const [steps, setSteps] = useState<ExplainStep[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [computing, setComputing] = useState(false)
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null)

  async function compute() {
    setComputing(true)
    setError(null)
    setSnapshotMsg(null)
    try {
      const [raw, full] = await Promise.all([
        api.productsComputeCost(productId),
        api.productsGetFull(productId),
      ])
      const r = asCostResult(raw)
      setResult(r)
      // Explainer input shim: explainCost only reads line counts, batch size,
      // waste and defect fractions — all taken from the same full record.
      const shim = {
        materials: full.materials,
        labor: full.labor,
        overhead: full.overhead,
        batchSize: String(full.batch_size),
        wastePct: full.waste_pct,
        defectPct: full.defect_pct,
      } as unknown as Parameters<typeof explainCost>[0]
      setSteps(explainCost(shim, r))
    } catch (e) {
      setError(errMsg(e))
      setResult(null)
      setSteps(null)
    }
    setComputing(false)
  }

  async function saveSnapshot() {
    setSnapshotMsg(null)
    try {
      const s = await api.productsSaveSnapshot(productId, snapshotLabel.trim() || undefined)
      setSnapshotMsg(`Snapshot saved — "${s.label || 'Snapshot'}" at ${fmtDate(s.created_at)}.`)
      setSnapshotLabel('')
    } catch (e) {
      setSnapshotMsg(`Could not save snapshot: ${errMsg(e)}`)
    }
  }

  const summary: Array<[string, string | undefined]> = result
    ? [
        ['Materials', result.materialCost],
        ['Packaging', result.packagingCost],
        ['Services', result.serviceCost],
        ['Labor', result.laborCost],
        ['Other direct', result.otherDirectCost],
        ['Components', result.componentCost],
        ['Direct cost', result.directCost],
        ['Overhead', result.overheadCost],
        ['Waste allowance', result.wasteCost],
        ['Total unit cost', result.totalUnitCost],
        ['Total batch cost', result.totalBatchCost],
        ['Usable units', undefined],
        ['Cost per usable unit', result.costPerUsableUnit],
      ]
    : []

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>
          Cost breakdown
        </div>
        <button type="button" onClick={() => void compute()} disabled={computing}>
          {computing ? 'Computing…' : result ? 'Recompute cost' : 'Compute cost'}
        </button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {!result && !error ? (
        <p className="muted">
          Compute the cost to see the full breakdown with per-line traces. Every number comes from
          the cost engine — nothing is estimated.
        </p>
      ) : null}

      {result ? (
        <>
          <div className="stat-grid">
            {summary.map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div className="stat-num money">
                  {value === undefined ? (
                    <span>{result.usableUnits}</span>
                  ) : label === 'Total unit cost' ? (
                    <strong>
                      <Money value={value} />
                    </strong>
                  ) : (
                    <Money value={value} />
                  )}
                </div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>

          {result.warnings.length > 0 ? (
            <div className="notice notice-warning">
              <strong>Warnings</strong>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.assumptions.length > 0 ? (
            <div className="notice">
              <strong>Assumptions</strong>
              <ul>
                {result.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="section-title" style={{ fontSize: 18, marginTop: 16 }}>
            Per-line trace
          </div>
          <div className="trace-list">
            {result.lines.map((line: TraceLine, i: number) => (
              <details key={i}>
                <summary>
                  <span>
                    <span className="pill" style={{ marginRight: 8 }}>
                      {line.category}
                    </span>
                    {line.label}
                  </span>
                  <span className="money">
                    <Money value={line.amount} />
                  </span>
                </summary>
                <div className="trace-formula">{line.formula}</div>
                <dl className="trace-inputs">
                  {Object.entries(line.inputs).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </div>

          {steps ? (
            <div className="mt-16">
              <ExplainView steps={steps} title="How the total was built" />
            </div>
          ) : null}

          <div className="mt-16">
            <div className="section-title" style={{ fontSize: 18 }}>
              Save snapshot
            </div>
            <p className="muted">
              Freezes this breakdown at a point in time. Snapshots are never rewritten — later
              price changes create new snapshots.
            </p>
            <div className="toolbar">
              <TextInput
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                placeholder="Snapshot label (optional)"
                style={{ minWidth: 280 }}
              />
              <button type="button" className="secondary" onClick={() => void saveSnapshot()}>
                Save snapshot
              </button>
            </div>
            {snapshotMsg ? <p className="muted">{snapshotMsg}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
