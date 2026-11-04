import { useState } from 'react'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, errMsg, fmtDate, useAsync } from '../components/hooks.js'
import { ConfirmDialog, Modal } from '../components/Modal.js'
import { Field, NumberInput, TextArea, TextInput, isDecimalString } from '../components/Form.js'
import type { LaborRole } from '../../../shared/types.js'

export default function Labor() {
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<LaborRole | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<LaborRole | null>(null)
  const q = useAsync(() => api.laborList(showArchived), [showArchived])
  const roles = q.data ?? []

  async function save(name: string, rate: string, notes: string): Promise<void> {
    if (!name.trim()) throw new Error('A role name is required.')
    if (rate.trim() !== '' && !isDecimalString(rate)) throw new Error('Rate must be a number.')
    if (editing === 'new') {
      await api.laborCreate({ name: name.trim(), rate_per_hour: rate.trim() || '0', notes })
    } else if (editing) {
      await api.laborUpdate({ id: editing.id, name: name.trim(), rate_per_hour: rate.trim() || '0', notes })
    }
    setEditing(null)
    q.reload()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Labor roles</h1>
        <button type="button" onClick={() => setEditing('new')}>
          New role
        </button>
      </div>
      <p className="muted">
        Labor roles carry the default hourly rate used when a product's labor line is set to
        hourly mode without its own rate.
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
      ) : roles.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No labor roles yet"
            message="Create roles like “Assembly” or “Packing” with their hourly rates, then use them on product labor lines."
            action={
              <button type="button" onClick={() => setEditing('new')}>
                New role
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
                <th>Rate / hour</th>
                <th>Notes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} style={r.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.archived ? (
                      <span className="pill pill-amber" style={{ marginLeft: 8 }}>
                        archived
                      </span>
                    ) : null}
                  </td>
                  <td className="money">
                    <Money value={r.rate_per_hour} />
                  </td>
                  <td className="muted">{r.notes || '—'}</td>
                  <td>{fmtDate(r.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link-btn" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => setConfirmDelete(r)}
                      >
                        {r.archived ? 'Delete' : 'Archive'}
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
        <RoleModal
          title={editing === 'new' ? 'New labor role' : `Edit role — ${editing.name}`}
          initial={
            editing === 'new'
              ? { name: '', rate: '', notes: '' }
              : { name: editing.name, rate: editing.rate_per_hour, notes: editing.notes }
          }
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={confirmDelete.archived ? 'Delete role permanently?' : 'Archive role?'}
          message={
            <p>
              <strong>{confirmDelete.name}</strong> will be{' '}
              {confirmDelete.archived ? 'permanently deleted' : 'archived'}. Product labor lines
              that reference it keep their own stored rate.
            </p>
          }
          confirmLabel={confirmDelete.archived ? 'Delete permanently' : 'Archive'}
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              if (confirmDelete.archived) await api.laborDelete(confirmDelete.id)
              else await api.laborArchive(confirmDelete.id)
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

function RoleModal({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string
  initial: { name: string; rate: string; notes: string }
  onClose: () => void
  onSave: (name: string, rate: string, notes: string) => Promise<void>
}) {
  const [name, setName] = useState(initial.name)
  const [rate, setRate] = useState(initial.rate)
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
                await onSave(name, rate, notes)
              } catch (e) {
                setError(errMsg(e))
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving…' : 'Save role'}
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Rate per hour" hint="Used as the default rate for hourly labor lines.">
        <NumberInput value={rate} onChange={setRate} placeholder="0.00" />
      </Field>
      <Field label="Notes">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  )
}
