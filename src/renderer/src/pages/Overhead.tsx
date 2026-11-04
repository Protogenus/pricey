import { useState } from 'react'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, errMsg, fmtDate, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import { Field, NumberInput, TextArea, TextInput, isDecimalString } from '../components/Form.js'
import type { OverheadItem } from '../../../shared/types.js'

export default function Overhead() {
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<OverheadItem | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<OverheadItem | null>(null)
  const q = useAsync(() => api.overheadList(showArchived), [showArchived])
  const items = q.data ?? []

  async function save(name: string, amount: string, period: string, notes: string): Promise<void> {
    if (!name.trim()) throw new Error('An item name is required.')
    if (amount.trim() !== '' && !isDecimalString(amount)) throw new Error('Amount must be a number.')
    if (editing === 'new') {
      await api.overheadCreate({ name: name.trim(), amount: amount.trim() || '0', period, notes })
    } else if (editing) {
      await api.overheadUpdate({
        id: editing.id,
        name: name.trim(),
        amount: amount.trim() || '0',
        period,
        notes,
      })
    }
    setEditing(null)
    q.reload()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Overhead</h1>
        <button type="button" onClick={() => setEditing('new')}>
          New overhead item
        </button>
      </div>
      <p className="muted">
        Overhead items are the recurring business costs allocated to products — rent, utilities,
        equipment. A product line can allocate them per unit, per batch, as a % of direct cost, per
        labor hour, or as a share of the monthly amount.
      </p>

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

      {q.loading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner message={q.error} onDismiss={q.reload} />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No overhead items yet"
            message="Add items like “Workshop rent” with the amount per period, then allocate them on product overhead lines."
            action={
              <button type="button" onClick={() => setEditing('new')}>
                New overhead item
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
                <th>Amount</th>
                <th>Period</th>
                <th>Notes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={it.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{it.name}</strong>
                    {it.archived ? (
                      <span className="pill pill-amber" style={{ marginLeft: 8 }}>
                        archived
                      </span>
                    ) : null}
                  </td>
                  <td className="money">
                    <Money value={it.amount} />
                  </td>
                  <td>{it.period || '—'}</td>
                  <td className="muted">{it.notes || '—'}</td>
                  <td>{fmtDate(it.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link-btn" onClick={() => setEditing(it)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => setConfirmDelete(it)}
                      >
                        {it.archived ? 'Delete' : 'Archive'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <ItemModal
          title={editing === 'new' ? 'New overhead item' : `Edit item — ${editing.name}`}
          initial={
            editing === 'new'
              ? { name: '', amount: '', period: 'monthly', notes: '' }
              : { name: editing.name, amount: editing.amount, period: editing.period, notes: editing.notes }
          }
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={confirmDelete.archived ? 'Delete item permanently?' : 'Archive item?'}
          message={
            <p>
              <strong>{confirmDelete.name}</strong> will be{' '}
              {confirmDelete.archived ? 'permanently deleted' : 'archived'}. Product overhead lines
              that reference it keep their own stored values.
            </p>
          }
          confirmLabel={confirmDelete.archived ? 'Delete permanently' : 'Archive'}
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              if (confirmDelete.archived) await api.overheadDelete(confirmDelete.id)
              else await api.overheadArchive(confirmDelete.id)
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

function ItemModal({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string
  initial: { name: string; amount: string; period: string; notes: string }
  onClose: () => void
  onSave: (name: string, amount: string, period: string, notes: string) => Promise<void>
}) {
  const [name, setName] = useState(initial.name)
  const [amount, setAmount] = useState(initial.amount)
  const [period, setPeriod] = useState(initial.period)
  const [notes, setNotes] = useState(initial.notes)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  return (
    <Modal
      title={title}
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
              setSaving(true)
              setError(null)
              try {
                await onSave(name, amount, period, notes)
              } catch (e) {
                setError(errMsg(e))
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving…' : 'Save item'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <div className="form-grid">
        <Field
          label="Amount"
          hint="For per-hour lines this is the hourly rate; for monthly-share lines the monthly amount."
        >
          <NumberInput value={amount} onChange={setAmount} placeholder="0.00" />
        </Field>
        <Field label="Period" hint="e.g. monthly, yearly. Informational.">
          <TextInput value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  )
}
