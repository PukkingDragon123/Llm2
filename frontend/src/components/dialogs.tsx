import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, runJob } from '../api/client'
import type { ImportResult, ProjectSummary } from '../api/types'
import { fmt } from '../lib/format'
import { Badge, ErrorBox, Field, Modal, Spinner, useToast } from './ui'

export function NewProjectDialog({ onClose, projects }: { onClose: () => void; projects: ProjectSummary[] }) {
  const nav = useNavigate()
  const toast = useToast()
  const [f, setF] = useState({ job_no: '', quotation_no: '', customer_name: '', product_subject: '', drawing_no: '', job_class: 'CUSTOM MADE', copy_from: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  async function create() {
    setBusy(true)
    setErr(null)
    try {
      const body = { ...f, copy_from: f.copy_from ? Number(f.copy_from) : null }
      const p = await api.post<{ id: number }>('/api/projects', body)
      toast.ok('Project created')
      nav(`/projects/${p.id}/overview`)
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }
  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={create} disabled={busy} data-testid="create-project">
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Job no."><input className="inp" value={f.job_no} onChange={set('job_no')} autoFocus /></Field>
        <Field label="Quotation no."><input className="inp" value={f.quotation_no} onChange={set('quotation_no')} /></Field>
        <Field label="Customer" wide><input className="inp" value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field label="Product subject" wide><input className="inp" value={f.product_subject} onChange={set('product_subject')} placeholder="e.g. Titanium Recycle Drum" /></Field>
        <Field label="Drawing no."><input className="inp" value={f.drawing_no} onChange={set('drawing_no')} /></Field>
        <Field label="Job class"><input className="inp" list="job-classes" value={f.job_class} onChange={set('job_class')} /><datalist id="job-classes"><option value="CUSTOM MADE" /><option value="STANDARD" /><option value="REPAIR" /></datalist></Field>
        <Field label="Copy from existing project (optional)" wide hint="Copies estimate and quotation text; supplier prices are kept as in the source – review them.">
          <select className="inp" value={f.copy_from} onChange={set('copy_from')}>
            <option value="">— start from factory defaults —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.job_no || `#${p.id}`} · {p.customer_name} · {p.product_subject}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorBox error={err} />
    </Modal>
  )
}

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState('quoted')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<ImportResult | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (res) onDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res])
  async function go() {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const r = await runJob<ImportResult>(api.upload<{ job_id: string }>('/api/import/workbook', file, { status }))
      setRes(r)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Import historical Prolog workbook"
      size="lg"
      onClose={onClose}
      footer={
        res ? (
          <>
            <button className="btn" onClick={onClose}>Close</button>
            <Link className="btn primary" to={`/projects/${res.project_id}/overview`} onClick={onClose}>Open imported project</Link>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={go} disabled={!file || busy} data-testid="import-go">
              {busy ? 'Importing…' : 'Import workbook'}
            </button>
          </>
        )
      }
    >
      {!res && (
        <>
          <p className="muted">
            Upload a Prolog quotation workbook (<code>.xls</code>/<code>.xlsx</code>). The importer creates a project with the full cost model, supplier prices (as verified history)
            and the quotation text, then recomputes it and checks it against the workbook’s own values.
          </p>
          <div className="form-grid">
            <Field label="Workbook file" wide>
              <input ref={input} type="file" accept=".xls,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="import-file" />
            </Field>
            <Field label="Status of imported project">
              <select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}>
                {['quoted', 'won', 'lost', 'completed', 'draft'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          {busy && <Spinner label="Importing and recomputing… this can take a few seconds" />}
          <ErrorBox error={err} />
        </>
      )}
      {res && (
        <>
          <div className="alert ok">Imported as project #{res.project_id}.</div>
          <h4>Workbook vs recomputed values</h4>
          <table className="dt compact" data-testid="import-checks">
            <thead>
              <tr><th>Check</th><th className="r">Workbook</th><th className="r">Recomputed</th><th>Result</th></tr>
            </thead>
            <tbody>
              {res.checks.map((c) => (
                <tr key={c.key}>
                  <td>{c.label} <code className="muted small">{c.key}</code></td>
                  <td className="r num">{c.workbook == null ? '—' : fmt(c.workbook)}</td>
                  <td className="r num">{fmt(c.recomputed)}</td>
                  <td>{c.match === true ? <Badge tone="green">match</Badge> : c.match === false ? <Badge tone="red">differs</Badge> : <Badge tone="amber" title={c.note}>not cached</Badge>}{c.note && <span className="muted small"> {c.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {res.notes.length > 0 && (
            <>
              <h4>Import notes ({res.notes.length})</h4>
              <ul className="notes">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
