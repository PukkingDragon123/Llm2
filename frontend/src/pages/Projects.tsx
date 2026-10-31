import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { ProjectSummary } from '../api/types'
import { ImportDialog, NewProjectDialog } from '../components/dialogs'
import { Badge, ErrorBox, Spinner, StatusBadge, useToast } from '../components/ui'
import { STATUSES, fmt, fmtDate, statusLabel } from '../lib/format'

export function Projects() {
  const nav = useNavigate()
  const toast = useToast()
  const [rows, setRows] = useState<ProjectSummary[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [dlg, setDlg] = useState<'new' | 'import' | null>(null)
  const load = useCallback(() => {
    api.get<ProjectSummary[]>('/api/projects').then(setRows).catch(setErr)
  }, [])
  useEffect(load, [load])
  const shown = useMemo(() => {
    const t = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (rows || []).filter((p) => (!status || p.status === status) && t.every((w) => `${p.job_no} ${p.quotation_no} ${p.customer_name} ${p.product_subject} ${p.drawing_no}`.toLowerCase().includes(w)))
  }, [rows, q, status])
  async function del(p: ProjectSummary) {
    if (!window.confirm(`Delete project ${p.job_no || '#' + p.id}? This also deletes its drawings and revisions.`)) return
    try {
      await api.del(`/api/projects/${p.id}`)
      toast.ok('Project deleted')
      load()
    } catch (e) {
      toast.err(e)
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">{rows ? `${shown.length} of ${rows.length} projects` : ''}</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setDlg('import')} data-testid="import-open">Import Prolog workbook…</button>
          <button className="btn primary" onClick={() => setDlg('new')} data-testid="new-project">+ New project</button>
        </div>
      </div>
      <div className="filters">
        <input className="inp search" placeholder="Search job no., customer, product…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        <select className="inp" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>
      <ErrorBox error={err} onRetry={load} />
      {!rows && !err && <Spinner label="Loading…" />}
      {rows && (
        <div className="card"><div className="card-body flush">
          <table className="dt" data-testid="projects-table">
            <thead>
              <tr><th>Job no.</th><th>Quotation no.</th><th>Customer</th><th>Product</th><th>Status</th><th className="r">Net total</th><th className="r">Missing</th><th>Updated</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => nav(`/projects/${p.id}/overview`)}>
                  <td><Link to={`/projects/${p.id}/overview`} onClick={(e) => e.stopPropagation()}>{p.job_no || `#${p.id}`}</Link></td>
                  <td>{p.quotation_no}</td>
                  <td>{p.customer_name}</td>
                  <td>{p.product_subject}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="r num">{fmt(p.summary?.totals?.net)} <span className="unit">{p.summary?.totals?.currency}</span></td>
                  <td className="r">{p.summary?.missing_count ? <Badge tone="red">{p.summary.missing_count}</Badge> : <Badge tone="green">0</Badge>}</td>
                  <td className="muted small">{fmtDate(p.updated_at)}</td>
                  <td className="act"><button className="icon-btn danger" title="Delete project" onClick={(e) => { e.stopPropagation(); void del(p) }}>✕</button></td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={9} className="empty-cell">No projects match.</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
      {dlg === 'new' && <NewProjectDialog projects={rows || []} onClose={() => setDlg(null)} />}
      {dlg === 'import' && <ImportDialog onClose={() => setDlg(null)} onDone={load} />}
    </div>
  )
}
