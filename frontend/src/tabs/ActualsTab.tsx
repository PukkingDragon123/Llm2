import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { ActualsRecord, SimilarProject } from '../api/types'
import { NumIn } from '../components/fields'
import { Badge, Card, ErrorBox, Spinner, StatusBadge, useToast } from '../components/ui'
import { useEditor } from '../editor'
import { evalNum, fmt, fmtPct, numToText } from '../lib/format'
import type { Num } from '../api/types'

const CATS: { id: string; label: string; unit: string }[] = [
  { id: 'material', label: 'Material (all supplier price sheets)', unit: 'THB' },
  { id: 'crews', label: 'In-house crew labor', unit: 'THB' },
  { id: 'services', label: 'Outsource / NDT / finishing services', unit: 'THB' },
  { id: 'machines', label: 'Machine process cost', unit: 'THB' },
  { id: 'man_days', label: 'Crew man-days (persons × days)', unit: 'man-days' },
  { id: 'machine_hours', label: 'Machine hours', unit: 'h' },
]

export function ActualsTab() {
  const { id, proj, result, reload, setField, fields } = useEditor()
  const toast = useToast()
  const rec: ActualsRecord | null = proj.actuals && proj.actuals.categories ? proj.actuals : null
  const [vals, setVals] = useState<Record<string, Num>>(() => Object.fromEntries(CATS.map((c) => [c.id, rec?.categories?.[c.id]?.actual ?? null])))
  const [note, setNote] = useState(rec?.note || '')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [basis, setBasis] = useState<Record<string, number> | null>(null)
  const [similar, setSimilar] = useState<SimilarProject[] | null>(null)

  useEffect(() => {
    // the server snapshots the latest issued revision's categories, else the current estimate
    const last = [...proj.revisions].sort((a, b) => b.rev_no - a.rev_no)[0]
    if (!last) { setBasis(null); return }
    api.get<{ summary: { categories_thb?: Record<string, number> } }>(`/api/revisions/${last.id}`).then((r) => setBasis(r.summary.categories_thb || null)).catch(() => setBasis(null))
  }, [proj.revisions])
  useEffect(() => {
    api.get<SimilarProject[]>(`/api/projects/${id}/similar`).then(setSimilar).catch(() => setSimilar([]))
  }, [id])

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const categories: Record<string, { actual: number }> = {}
      for (const c of CATS) {
        const v = vals[c.id]
        if (v == null || v === '') continue
        const n = evalNum(v)
        if (n == null) throw new Error(`“${c.label}”: not a valid number`)
        categories[c.id] = { actual: n }
      }
      await api.put(`/api/projects/${id}/actuals`, { categories, note, mark_completed: done })
      if (done) setField('status', 'completed')
      await reload()
      toast.ok('Actuals recorded')
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const est = (c: string): number | null => rec?.categories?.[c]?.estimate ?? (basis ? basis[c] : result.categories_thb?.[c]) ?? null
  return (
    <div className="stack">
      <Card title="Actual costs (learning)" actions={<><StatusBadge status={fields.status} />{rec && <Badge tone="green">recorded {rec.recorded_at?.slice(0, 10)}</Badge>}</>}>
        <p className="muted small">Record what the job actually cost after production. The comparison against the estimate (frozen at the time of recording: the latest issued revision, else the current estimate) feeds the calibration suggestions for future quotations.</p>
        <table className="dt" data-testid="actuals-table">
          <thead><tr><th>Category</th><th className="r">Estimate</th><th className="r">Actual</th><th className="r">Variance</th><th className="r">Variance %</th></tr></thead>
          <tbody>
            {CATS.map((c) => {
              const e = est(c.id)
              const a = evalNum(vals[c.id])
              const diff = a != null && e != null ? a - e : null
              const pct = a != null && e ? a / e - 1 : null
              return (
                <tr key={c.id}>
                  <td>{c.label} <span className="unit">{c.unit}</span></td>
                  <td className="r num">{fmt(e)}</td>
                  <td className="r"><NumIn value={vals[c.id]} ariaLabel={`Actual ${c.label}`} path={`actuals.${c.id}`} onChange={(v) => setVals({ ...vals, [c.id]: v })} /></td>
                  <td className={`r num ${diff == null ? '' : diff > 0 ? 'up' : 'down'}`}>{diff == null ? '—' : (diff > 0 ? '+' : '') + fmt(diff)}</td>
                  <td className={`r num ${pct == null ? '' : pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : ''}`}>{pct == null ? '—' : (pct > 0 ? '+' : '') + fmtPct(pct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <label className="field wide" style={{ marginTop: 12 }}><span className="field-label">Note</span><textarea className="inp" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. extra weld repair on bottom head" /></label>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <label className="chk"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> mark project as completed</label>
          <button className="btn primary" onClick={() => void save()} disabled={busy} data-testid="save-actuals">{busy ? 'Saving…' : 'Record actuals'}</button>
        </div>
        <ErrorBox error={err} />
        <p className="muted small">Entered values: {CATS.filter((c) => vals[c.id] != null && vals[c.id] !== '').map((c) => `${c.id}=${numToText(vals[c.id])}`).join(', ') || 'none'}</p>
      </Card>

      <Card title="Similar past projects" flush>
        {!similar && <div style={{ padding: 12 }}><Spinner /></div>}
        {similar && (
          <table className="dt compact" data-testid="similar-table">
            <thead><tr><th>Project</th><th>Customer / product</th><th>Status</th><th className="r">Score</th><th>Why similar</th></tr></thead>
            <tbody>
              {similar.map((s) => (
                <tr key={s.project.id}>
                  <td><Link to={`/projects/${s.project.id}/overview`}>{s.project.job_no || `#${s.project.id}`}</Link></td>
                  <td>{s.project.customer_name}<div className="muted small">{s.project.product_subject}</div></td>
                  <td><StatusBadge status={s.project.status} /> {s.project.has_actuals && <Badge tone="green">actuals</Badge>}</td>
                  <td className="r num">{fmt(s.score, 3)}</td>
                  <td className="small">{s.why.join(' · ') || '—'}</td>
                </tr>
              ))}
              {similar.length === 0 && <tr><td colSpan={5} className="empty-cell">No other projects to compare with yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
