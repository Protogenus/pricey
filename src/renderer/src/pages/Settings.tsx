import { useState } from 'react'
import Decimal from 'decimal.js'
import { api } from '../api.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, errMsg, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import { Field, NumberInput, Select, TextArea, TextInput, isDecimalString } from '../components/Form.js'
import { useCurrency } from '../components/Currency.js'
import type { CustomUnitDef, UnitDimension } from '../../../engine/units.js'

const DIMENSIONS: Exclude<UnitDimension, 'custom'>[] = ['mass', 'volume', 'length', 'area', 'count']
const EXPORT_KINDS = ['materials', 'products', 'quotes', 'pricing'] as const

interface IntegrationContract {
  name: string
  version: number
  direction: string
  title: string
  description: string
  status: string
}

export default function Settings() {
  const { reload: reloadCurrency } = useCurrency()
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const businessQ = useAsync(async () => {
    const keys = [
      'pricey.business.name',
      'pricey.business.address',
      'pricey.business.email',
      'pricey.business.phone',
      'pricey.business.logoPath',
      'pricey.business.terms',
      'pricey.currency',
      'pricey.overhead.hoursPerMonth',
    ] as const
    const out: Record<string, string> = {}
    for (const k of keys) {
      out[k] = (await api.settingsGet(k).catch(() => null)) ?? ''
    }
    return out
  }, [])
  const dataPathQ = useAsync(() => api.settingsGetDataPath(), [])
  const contractsQ = useAsync(
    () => api.integrationsContracts() as unknown as Promise<IntegrationContract[]>,
    [],
  )

  const [form, setForm] = useState<Record<string, string> | null>(null)
  const business = form ?? businessQ.data ?? null
  const set = (k: string, v: string) => {
    const base = business ?? {}
    setForm({ ...base, [k]: v })
  }

  async function saveAll() {
    if (!business) return
    setError(null)
    setSavedMsg(null)
    try {
      for (const [k, v] of Object.entries(business)) {
        await api.settingsSet(k, v)
      }
      setForm(null)
      businessQ.reload()
      reloadCurrency()
      setSavedMsg('Settings saved.')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
        <button type="button" onClick={() => void saveAll()} disabled={!business || businessQ.loading}>
          Save settings
        </button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {savedMsg ? (
        <div className="notice notice-success mb-16">
          <strong>{savedMsg}</strong>
        </div>
      ) : null}

      {businessQ.loading || !business ? (
        <Loading />
      ) : businessQ.error ? (
        <ErrorBanner message={businessQ.error} onDismiss={businessQ.reload} />
      ) : (
        <>
          <div className="card mb-16">
            <div className="section-title">Business info</div>
            <p className="muted">
              Printed on quotes and PDF exports. Quotes copy this in when they are created — editing
              here does not rewrite existing quotes.
            </p>
            <div className="form-grid">
              <Field label="Business name">
                <TextInput value={business['pricey.business.name']} onChange={(e) => set('pricey.business.name', e.target.value)} />
              </Field>
              <Field label="Address">
                <TextInput value={business['pricey.business.address']} onChange={(e) => set('pricey.business.address', e.target.value)} />
              </Field>
              <Field label="Email">
                <TextInput value={business['pricey.business.email']} onChange={(e) => set('pricey.business.email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <TextInput value={business['pricey.business.phone']} onChange={(e) => set('pricey.business.phone', e.target.value)} />
              </Field>
              <Field label="Logo path" hint="Local image path, used on quote PDFs.">
                <TextInput value={business['pricey.business.logoPath']} onChange={(e) => set('pricey.business.logoPath', e.target.value)} />
              </Field>
            </div>
            <Field label="Default terms">
              <TextArea value={business['pricey.business.terms']} onChange={(e) => set('pricey.business.terms', e.target.value)} />
            </Field>
          </div>

          <div className="card mb-16">
            <div className="section-title">Display</div>
            <div className="form-grid">
              <Field label="Currency code" hint="e.g. USD, EUR, GBP. Amounts are stored currency-agnostic; this only changes the symbol shown.">
                <TextInput
                  value={business['pricey.currency']}
                  onChange={(e) => set('pricey.currency', e.target.value.toUpperCase())}
                  placeholder="USD"
                />
              </Field>
              <Field
                label="Overhead default — hours per month"
                hint="Planning reference for your own overhead math. The cost engine uses batch size as monthly units and the linked item's amount as the monthly amount."
              >
                <NumberInput value={business['pricey.overhead.hoursPerMonth']} onChange={(v) => set('pricey.overhead.hoursPerMonth', v)} />
              </Field>
            </div>
          </div>

          <CustomUnitsSection />
          <DataSection />
          <IntegrationsSection contracts={contractsQ.data ?? []} loading={contractsQ.loading} error={contractsQ.error} />

          <div className="card">
            <div className="section-title">Database location</div>
            {dataPathQ.loading ? (
              <Loading />
            ) : dataPathQ.error ? (
              <ErrorBanner message={dataPathQ.error} />
            ) : (
              <p className="muted" style={{ wordBreak: 'break-all' }}>
                {dataPathQ.data}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Custom units                                                        */
/* ------------------------------------------------------------------ */

function CustomUnitsSection() {
  const q = useAsync(async () => {
    const raw = await api.settingsGet('pricey.customUnits')
    if (!raw) return [] as CustomUnitDef[]
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as CustomUnitDef[]) : []
    } catch {
      return []
    }
  }, [])
  const [editing, setEditing] = useState<CustomUnitDef | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CustomUnitDef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const units = q.data ?? []

  async function persist(next: CustomUnitDef[]) {
    try {
      await api.settingsSet('pricey.customUnits', JSON.stringify(next))
      q.reload()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="card mb-16">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>
          Custom units
        </div>
        <button type="button" className="secondary" onClick={() => setEditing('new')}>
          Add custom unit
        </button>
      </div>
      <p className="muted">
        Register units the built-in registry doesn't know — e.g. a "skein" of yarn with its gram
        equivalent. Conversions between custom units use the dimension you declare.
      </p>
      {error ? <ErrorBanner message={error} /> : null}
      {q.loading ? (
        <Loading />
      ) : units.length === 0 ? (
        <EmptyState
          title="No custom units"
          message="The built-in registry covers mass, volume, length, area and count units. Add your own here when you need them."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Dimension</th>
              <th>Factor to base unit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.symbol}>
                <td>
                  <strong>{u.symbol}</strong>
                </td>
                <td>{u.dimension}</td>
                <td className="money">{u.toBase}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="link-btn" onClick={() => setEditing(u)}>
                      Edit
                    </button>
                    <button type="button" className="link-btn danger" onClick={() => setConfirmDelete(u)}>
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
        <CustomUnitModal
          initial={editing === 'new' ? undefined : editing}
          existing={units}
          onClose={() => setEditing(null)}
          onSave={(u) => {
            const next =
              editing === 'new'
                ? [...units, u]
                : units.map((x) => (x.symbol === (editing as CustomUnitDef).symbol ? u : x))
            setEditing(null)
            void persist(next)
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete custom unit?"
          message={
            <p>
              Delete custom unit "{confirmDelete.symbol}"? Material lines using it will fail unit
              conversion until they are changed.
            </p>
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            setConfirmDelete(null)
            void persist(units.filter((u) => u.symbol !== (confirmDelete as CustomUnitDef).symbol))
          }}
        />
      ) : null}
    </div>
  )
}

function CustomUnitModal({
  initial,
  existing,
  onClose,
  onSave,
}: {
  initial?: CustomUnitDef
  existing: CustomUnitDef[]
  onClose: () => void
  onSave: (u: CustomUnitDef) => void
}) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? '')
  const [dimension, setDimension] = useState<Exclude<UnitDimension, 'custom'>>(initial?.dimension ?? 'mass')
  const [toBase, setToBase] = useState(initial?.toBase ?? '')
  const [error, setError] = useState<string | null>(null)

  const baseUnit = { mass: 'g', volume: 'ml', length: 'cm', area: 'cm²', count: 'piece' }[dimension]

  function save() {
    const sym = symbol.trim()
    if (!sym) {
      setError('A symbol is required.')
      return
    }
    if (!initial && existing.some((u) => u.symbol === sym)) {
      setError(`A custom unit "${sym}" already exists.`)
      return
    }
    if (!isDecimalString(toBase) || !new Decimal(toBase).gt(0)) {
      setError('Factor to base unit must be a number greater than zero.')
      return
    }
    onSave({ symbol: sym, dimension, toBase: new Decimal(toBase).toString() })
  }

  return (
    <Modal
      title={initial ? `Edit custom unit — ${initial.symbol}` : 'Add custom unit'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={save}>
            Save unit
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="form-grid">
        <Field label="Symbol" hint="e.g. skein, spool.">
          <TextInput value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={!!initial} autoFocus />
        </Field>
        <Field label="Dimension">
          <Select
            value={dimension}
            onChange={(v) => setDimension(v as Exclude<UnitDimension, 'custom'>)}
            options={DIMENSIONS.map((d) => ({ value: d, label: d }))}
          />
        </Field>
        <Field
          label={`One ${symbol.trim() || 'unit'} = ? ${baseUnit}`}
          hint="Exact decimal factor converting one of this unit into the dimension's base unit."
        >
          <NumberInput value={toBase} onChange={setToBase} />
        </Field>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Data: backup / restore / export / import                             */
/* ------------------------------------------------------------------ */

function DataSection() {
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)
  const [importReport, setImportReport] = useState<{
    created: number
    skipped: number
    errors: string[]
  } | null>(null)

  async function backup() {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      // No destination → the backend shows a native save dialog.
      const dest = await (api.settingsBackup as (d?: string) => Promise<string>)()
      setMsg(`Backup saved to ${dest}`)
    } catch (e) {
      setError(errMsg(e))
    }
    setBusy(false)
  }

  function pickRestoreFile(file: File & { path?: string }) {
    const path = file.path
    if (!path) {
      setError('Could not resolve the selected file path.')
      return
    }
    setConfirmRestore(path)
  }

  async function doRestore(path: string) {
    setBusy(true)
    setError(null)
    try {
      await api.settingsRestore(path)
      // The backend closed and reopened the database — reload the whole app.
      window.location.reload()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
    setConfirmRestore(null)
  }

  async function exportFile(kind: string, format: 'csv' | 'xlsx') {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const fn =
        format === 'csv'
          ? (api.exportsCsv as (k?: string) => Promise<string>)
          : (api.exportsXlsx as (k?: string) => Promise<string>)
      const dest = await fn(kind)
      setMsg(`Exported ${kind} (${format.toUpperCase()}) to ${dest}`)
    } catch (e) {
      setError(errMsg(e))
    }
    setBusy(false)
  }

  async function downloadTemplate(kind: string) {
    setError(null)
    try {
      const text = await (api.exportsImportTemplate as (k?: string) => Promise<string>)(kind)
      const blob = new Blob([text], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pricey-${kind}-import-template.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function importCsv(file: File & { path?: string }) {
    const path = file.path
    if (!path) {
      setError('Could not resolve the selected file path.')
      return
    }
    setBusy(true)
    setError(null)
    setImportReport(null)
    try {
      const r = (await api.materialsImportCsv(path)) as unknown as {
        created: number
        skipped: number
        errors: string[]
      }
      setImportReport(r)
    } catch (e) {
      setError(errMsg(e))
    }
    setBusy(false)
  }

  return (
    <div className="card mb-16">
      <div className="section-title">Data</div>
      {error ? <ErrorBanner message={error} /> : null}
      {msg ? (
        <div className="notice notice-success">
          <strong>{msg}</strong>
        </div>
      ) : null}

      <div className="section-title" style={{ fontSize: 16 }}>
        Backup & restore
      </div>
      <div className="toolbar">
        <button type="button" className="secondary" onClick={() => void backup()} disabled={busy}>
          Back up database…
        </button>
        <label className="secondary" style={{ cursor: 'pointer', padding: '9px 18px', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)' }}>
          Restore from backup…
          <input
            type="file"
            accept=".db,.sqlite,.sqlite3"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0] as (File & { path?: string }) | undefined
              if (f) pickRestoreFile(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      <div className="section-title" style={{ fontSize: 16, marginTop: 16 }}>
        Export
      </div>
      {EXPORT_KINDS.map((kind) => (
        <div className="toolbar" key={kind}>
          <strong style={{ minWidth: 90, textTransform: 'capitalize' }}>{kind}</strong>
          <button type="button" className="secondary" onClick={() => void exportFile(kind, 'csv')} disabled={busy}>
            Export CSV…
          </button>
          <button type="button" className="secondary" onClick={() => void exportFile(kind, 'xlsx')} disabled={busy}>
            Export XLSX…
          </button>
          {kind === 'materials' ? (
            <button type="button" className="secondary" onClick={() => void downloadTemplate(kind)} disabled={busy}>
              Import template
            </button>
          ) : null}
        </div>
      ))}

      <div className="section-title" style={{ fontSize: 16, marginTop: 16 }}>
        Import materials (CSV)
      </div>
      <p className="muted">
        Download the import template above for the expected columns. Rows that fail validation are
        reported below — nothing is partially imported without telling you.
      </p>
      <div className="toolbar">
        <label className="secondary" style={{ cursor: 'pointer', padding: '9px 18px', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)' }}>
          Choose CSV file…
          <input
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0] as (File & { path?: string }) | undefined
              if (f) void importCsv(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {importReport ? (
        <div className={importReport.errors.length > 0 ? 'notice notice-warning' : 'notice notice-success'}>
          <strong>
            Import finished — {importReport.created} created, {importReport.skipped} skipped
          </strong>
          {importReport.errors.length > 0 ? (
            <ul>
              {importReport.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {confirmRestore ? (
        <ConfirmDialog
          title="Restore database from backup?"
          message={
            <>
              <p>
                This replaces the current database with <strong>{confirmRestore}</strong>. Any
                changes since that backup was made will be lost.
              </p>
              <p className="muted">The backup file is verified before anything is touched.</p>
            </>
          }
          confirmLabel="Restore"
          danger
          onCancel={() => setConfirmRestore(null)}
          onConfirm={() => void doRestore(confirmRestore)}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

function IntegrationsSection({
  contracts,
  loading,
  error,
}: {
  contracts: IntegrationContract[]
  loading: boolean
  error: string | null
}) {
  return (
    <div className="card mb-16">
      <div className="section-title">Integrations</div>
      <p className="muted">
        Data contracts for exchanging costs and prices with other Clever Signal apps. None are
        connected — each contract below describes what a manual exchange looks like today.
      </p>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : contracts.length === 0 ? (
        <EmptyState title="No contracts" message="No integration contracts are defined." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Direction</th>
              <th>Status</th>
              <th>Manual exchange</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.name}>
                <td>
                  <strong>{c.title}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {c.name} · v{c.version}
                  </div>
                </td>
                <td>
                  <span className="pill">{c.direction}</span>
                </td>
                <td>
                  <span className="pill pill-amber">Not connected</span>
                </td>
                <td className="muted">{c.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
