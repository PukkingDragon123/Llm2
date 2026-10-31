import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Dashboard as Dash, ProjectSummary } from '../api/types'
import { ImportDialog, NewProjectDialog } from '../components/dialogs'
import { Badge, Card, ErrorBox, Spinner, StatusBadge } from '../components/ui'
import { fmt, fmtDate } from '../lib/format'

function Kpi({ label, value, sub, tone, to }: { label: string; value: string; sub?: string; tone?: 'warn' | 'good'; to?: string }) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value num ${tone || ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  )
  return to ? <Link to={to} className="kpi link">{body}</Link> : <div className="kpi">{body}</div>
}

export function Dashboard() {
  const nav = useNavigate()
  const [d, setD] = useState<Dash | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [dlg, setDlg] = useState<'new' | 'import' | null>(null)
  const [all, setAll] = useState<ProjectSummary[]>([])
  const load = useCallback(() => {
    api.get<Dash>('/api/dashboard').then(setD).catch(setErr)
    api.get<ProjectSummary[]>('/api/projects').then(setAll).catch(() => {})
  }, [])
  useEffect(load, [load])
  const cur = d?.recent[0]?.summary?.totals?.currency || 'USD'
  const maxStatus = d ? Math.max(1, ...Object.values(d.by_status)) : 1
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Engineering cost estimates and quotations</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setDlg('import')} data-testid="import-open">Import historical workbook</button>
          <button className="btn primary" onClick={() => setDlg('new')} data-testid="new-project">+ New project</button>
        </div>
      </div>
      <ErrorBox error={err} onRetry={load} />
      {!d && !err && <Spinner label="Loading…" />}
      {d && (
        <>
          <div className="kpis" data-testid="kpis">
            <Kpi label="Projects" value={String(d.projects)} sub={Object.entries(d.by_status).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(' · ')} to="/projects" />
            <Kpi label={`Pipeline net (${cur})`} value={fmt(d.pipeline_net, 0)} sub="draft + quoted" />
            <Kpi label={`Won net (${cur})`} value={fmt(d.won_net, 0)} sub="won, in production, completed" tone="good" />
            <Kpi label="Open missing inputs" value={String(d.open_missing_inputs)} sub="across draft projects" tone={d.open_missing_inputs ? 'warn' : 'good'} />
            <Kpi label="Supplier prices" value={String(d.supplier_prices)} sub="verified price list" to="/suppliers" />
            <Kpi label="Projects with actuals" value={String(d.with_actuals)} sub="used for calibration" to="/learning" />
            <Kpi label="Claude AI" value={d.ai.configured ? 'Connected' : 'Not configured'} sub={d.ai.configured ? d.ai.model : 'add an API key in Settings'} tone={d.ai.configured ? 'good' : 'warn'} to="/settings" />
          </div>
          <div className="two-col">
            <Card title="Recent projects" actions={<Link to="/projects" className="link">All projects →</Link>} flush>
              <table className="dt compact" data-testid="recent-projects">
                <thead>
                  <tr><th>Job no.</th><th>Customer / product</th><th>Status</th><th className="r">Net ({cur})</th><th className="r">Missing</th><th>Updated</th></tr>
                </thead>
                <tbody>
                  {d.recent.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => nav(`/projects/${p.id}/overview`)}>
                      <td><Link to={`/projects/${p.id}/overview`}>{p.job_no || `#${p.id}`}</Link></td>
                      <td>{p.customer_name}<div className="muted small">{p.product_subject}</div></td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="r num">{fmt(p.summary?.totals?.net)}</td>
                      <td className="r">{p.summary?.missing_count ? <Badge tone="red">{p.summary.missing_count}</Badge> : <Badge tone="green">0</Badge>}</td>
                      <td className="muted small">{fmtDate(p.updated_at)}</td>
                    </tr>
                  ))}
                  {d.recent.length === 0 && <tr><td colSpan={6} className="empty-cell">No projects yet — create one or import a historical workbook.</td></tr>}
                </tbody>
              </table>
            </Card>
            <Card title="Projects by status">
              <div className="bars">
                {Object.entries(d.by_status).map(([k, v]) => (
                  <div key={k} className="bar-row">
                    <span className="bar-label">{k.replace(/_/g, ' ')}</span>
                    <span className="bar"><span style={{ width: `${(v / maxStatus) * 100}%` }} /></span>
                    <span className="num">{v}</span>
                  </div>
                ))}
              </div>
              <h4 style={{ marginTop: 20 }}>Quick actions</h4>
              <div className="btn-col">
                <button className="btn" onClick={() => setDlg('new')}>New project…</button>
                <button className="btn" onClick={() => setDlg('import')}>Import historical workbook…</button>
                <Link className="btn" to="/suppliers">Maintain supplier prices</Link>
                <Link className="btn" to="/learning">Review estimate-vs-actual history</Link>
              </div>
            </Card>
          </div>
        </>
      )}
      {dlg === 'new' && <NewProjectDialog projects={all} onClose={() => setDlg(null)} />}
      {dlg === 'import' && <ImportDialog onClose={() => setDlg(null)} onDone={load} />}
    </div>
  )
}
