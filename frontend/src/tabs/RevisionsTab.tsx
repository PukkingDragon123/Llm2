import { useState } from 'react'
import { api } from '../api/client'
import type { CompareRow, RevisionRow } from '../api/types'
import { IssueRevisionModal } from '../components/IssueRevision'
import { PdfView } from '../components/PdfView'
import { Badge, Card, ErrorBox, Spinner } from '../components/ui'
import { useEditor } from '../editor'
import { fmt, fmtDate } from '../lib/format'

const FILE_LABEL: Record<string, string> = { quotation_pdf: 'Quotation PDF', quotation_xlsx: 'Quotation xlsx', costing_xlsx: 'Costing xlsx', costing_pdf: 'Costing PDF' }

export function RevisionsTab() {
  const { proj, id } = useEditor()
  const [dlg, setDlg] = useState(false)
  const [view, setView] = useState<string | null>(null)
  const revs = [...proj.revisions].sort((a, b) => b.rev_no - a.rev_no)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [cmp, setCmp] = useState<CompareRow[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  async function compare() {
    setBusy(true)
    setErr(null)
    try {
      setCmp(await api.get<CompareRow[]>(`/api/projects/${id}/revisions/compare?a=${a}&b=${b}`))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const cur = proj.revisions[0]?.totals?.currency || 'USD'
  return (
    <div className="stack">
      <Card title={`Issued revisions (${revs.length})`} actions={<button className="btn primary" onClick={() => setDlg(true)} data-testid="issue-new-rev">Issue new revision…</button>} flush>
        <table className="dt" data-testid="revisions-table">
          <thead><tr><th>Rev</th><th>Quotation no.</th><th>Issued</th><th>Note</th><th className="r">Total</th><th className="r">Net</th><th>Files</th></tr></thead>
          <tbody>
            {revs.map((r: RevisionRow) => (
              <tr key={r.id}>
                <td><Badge tone="blue">Rev {r.rev_no}</Badge></td>
                <td>{r.quotation_no}</td>
                <td className="small">{fmtDate(r.created_at)}</td>
                <td>{r.note}</td>
                <td className="r num">{fmt(r.totals?.total)}</td>
                <td className="r num"><strong>{fmt(r.totals?.net)}</strong></td>
                <td className="files">
                  {Object.entries(r.files).filter(([k]) => FILE_LABEL[k]).map(([k, name]) => {
                    const u = `/api/revisions/${r.id}/files/${encodeURIComponent(name)}`
                    return (
                      <span key={k} className="file-link">
                        <a href={u} download>{FILE_LABEL[k]}</a>
                        {k.endsWith('pdf') && <button className="link small" onClick={() => setView(`${u}?inline=true`)}>view</button>}
                      </span>
                    )
                  })}
                </td>
              </tr>
            ))}
            {revs.length === 0 && <tr><td colSpan={7} className="empty-cell">No revision issued yet. Resolve open questions, then “Issue revision”.</td></tr>}
          </tbody>
        </table>
      </Card>
      {view && (
        <Card title="Revision file" actions={<><a className="btn sm" href={view} target="_blank" rel="noreferrer">Open in new tab</a><button className="btn sm" onClick={() => setView(null)}>Close</button></>} flush>
          <PdfView key={view} url={view} title="Revision PDF" />
        </Card>
      )}
      <Card title="Compare revisions">
        {revs.length < 2 ? <p className="muted">Issue at least two revisions to compare them.</p> : (
          <>
            <div className="btn-row">
              <select className="inp" value={a} onChange={(e) => setA(e.target.value)} aria-label="Revision A"><option value="">Revision A…</option>{revs.map((r) => <option key={r.id} value={r.id}>Rev {r.rev_no} — {r.quotation_no}</option>)}</select>
              <span>→</span>
              <select className="inp" value={b} onChange={(e) => setB(e.target.value)} aria-label="Revision B"><option value="">Revision B…</option>{revs.map((r) => <option key={r.id} value={r.id}>Rev {r.rev_no} — {r.quotation_no}</option>)}</select>
              <button className="btn" disabled={!a || !b || busy} onClick={() => void compare()}>Compare</button>
            </div>
            {busy && <Spinner />}
            <ErrorBox error={err} />
            {cmp && (
              <table className="dt compact" style={{ marginTop: 10 }}>
                <thead><tr><th>Item</th><th>Heading</th><th className="r">A ({cur})</th><th className="r">B ({cur})</th><th className="r">Delta</th></tr></thead>
                <tbody>
                  {cmp.map((r, i) => (
                    <tr key={i} className={typeof r.item === 'string' ? 'tot' : ''}>
                      <td>{r.item}</td><td>{r.heading}</td><td className="r num">{fmt(r.a)}</td><td className="r num">{fmt(r.b)}</td>
                      <td className={`r num ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}`}>{r.delta > 0 ? '+' : ''}{fmt(r.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Card>
      {dlg && <IssueRevisionModal onClose={() => setDlg(false)} />}
    </div>
  )
}
