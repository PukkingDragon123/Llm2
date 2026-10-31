import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Calibration, ProjectSummary } from '../api/types'
import { Badge, Card, ErrorBox, Spinner, StatusBadge } from '../components/ui'
import { fmt, fmtPct } from '../lib/format'

export function Learning() {
  const [jobClass, setJobClass] = useState('')
  const [cal, setCal] = useState<Calibration | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [err, setErr] = useState<unknown>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { api.get<ProjectSummary[]>('/api/projects').then(setProjects).catch(setErr) }, [])
  useEffect(() => {
    setCal(null)
    api.get<Calibration>(`/api/learning/calibration${jobClass ? `?job_class=${encodeURIComponent(jobClass)}` : ''}`).then(setCal).catch(setErr)
  }, [jobClass])
  const classes = [...new Set(projects.map((p) => p.job_class).filter(Boolean))]
  const withAct = projects.filter((p) => p.has_actuals)
  const projIds = cal ? [...new Map(Object.values(cal).flatMap((c) => c.projects).map((p) => [p.project_id, p.job_no])).entries()] : []
  return (
    <div className="page">
      <div className="page-head"><div><h1>History &amp; learning</h1><p className="muted">Estimate-vs-actual calibration learned from completed projects. Factors are suggestions: they are only applied when an engineer adds them as an adjustment on a quote item.</p></div>
        <select className="inp" value={jobClass} onChange={(e) => setJobClass(e.target.value)} aria-label="Job class"><option value="">All job classes</option>{classes.map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <ErrorBox error={err} />
      {!cal && !err && <Spinner />}
      {cal && (
        <Card title="Calibration by cost category" flush>
          <table className="dt" data-testid="calibration-table">
            <thead><tr><th>Category</th><th className="r">Projects (n)</th><th className="r">Factor (actual ÷ estimate)</th><th className="r">Suggested adjustment</th><th className="r">Min</th><th className="r">Max</th><th className="r">Std dev</th><th>Evidence</th><th /></tr></thead>
            <tbody>
              {Object.entries(cal).map(([k, c]) => (
                <Fragment key={k}>
                  <tr>
                    <td><strong>{c.label}</strong> <code className="muted small">{k}</code></td>
                    <td className="r">{c.n}</td>
                    <td className="r num">{c.factor != null ? fmt(c.factor, 3) : '—'}</td>
                    <td className="r num">{c.suggested_pct != null ? fmtPct(c.suggested_pct) : '—'}</td>
                    <td className="r num">{c.min_ratio != null ? fmt(c.min_ratio, 3) : '—'}</td>
                    <td className="r num">{c.max_ratio != null ? fmt(c.max_ratio, 3) : '—'}</td>
                    <td className="r num">{c.stdev != null ? fmt(c.stdev, 3) : '—'}</td>
                    <td>{c.n === 0 ? <Badge>no data</Badge> : c.reliable ? <Badge tone="green">reliable</Badge> : <Badge tone="amber" title="Needs ≥ 3 projects with std dev &lt; 0.25">low evidence</Badge>}</td>
                    <td>{c.n > 0 && <button className="link small" onClick={() => setOpen(open === k ? null : k)}>{open === k ? 'hide' : 'projects'}</button>}</td>
                  </tr>
                  {open === k && (
                    <tr className="expanded-row"><td colSpan={9}>
                      <table className="dt compact"><thead><tr><th>Project</th><th className="r">Estimate</th><th className="r">Actual</th><th className="r">Ratio</th></tr></thead>
                        <tbody>{c.projects.map((p) => <tr key={p.project_id}><td><Link to={`/projects/${p.project_id}/actuals`}>{p.job_no}</Link></td><td className="r num">{fmt(p.estimate)}</td><td className="r num">{fmt(p.actual)}</td><td className="r num">{fmt(p.ratio, 3)}</td></tr>)}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {cal && projIds.length > 0 && (
        <Card title="Per-project ratios (actual ÷ estimate)" flush>
          <table className="dt compact"><thead><tr><th>Project</th>{Object.entries(cal).map(([k, c]) => <th key={k} className="r">{c.label.split(' (')[0]}</th>)}</tr></thead>
            <tbody>{projIds.map(([pid, job]) => (
              <tr key={pid}><td><Link to={`/projects/${pid}/actuals`}>{job}</Link></td>
                {Object.entries(cal).map(([k, c]) => { const r = c.projects.find((p) => p.project_id === pid); return <td key={k} className={`r num ${r ? (r.ratio > 1.05 ? 'up' : r.ratio < 0.95 ? 'down' : '') : ''}`}>{r ? fmt(r.ratio, 3) : '—'}</td> })}
              </tr>))}</tbody>
          </table>
        </Card>
      )}
      <Card title={`Projects with recorded actuals (${withAct.length})`} flush>
        <table className="dt compact">
          <thead><tr><th>Job no.</th><th>Customer / product</th><th>Class</th><th>Status</th><th className="r">Net</th><th /></tr></thead>
          <tbody>
            {withAct.map((p) => <tr key={p.id}><td><Link to={`/projects/${p.id}/actuals`}>{p.job_no}</Link></td><td>{p.customer_name}<div className="muted small">{p.product_subject}</div></td><td>{p.job_class}</td><td><StatusBadge status={p.status} /></td><td className="r num">{fmt(p.summary?.totals?.net)}</td><td><Link className="link" to={`/projects/${p.id}/actuals`}>actuals →</Link></td></tr>)}
            {withAct.length === 0 && <tr><td colSpan={6} className="empty-cell">No actuals recorded yet. Open a completed project → Actuals tab → record the real costs.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
