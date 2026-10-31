import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { IssueList, IssueRevisionModal } from '../components/IssueRevision'
import { Badge, Spinner } from '../components/ui'
import { ProjectEditorProvider, useEditor } from '../editor'
import { STATUSES, fmt, statusLabel } from '../lib/format'
import { ActualsTab } from '../tabs/ActualsTab'
import { AiTab } from '../tabs/AiTab'
import { BomTab } from '../tabs/BomTab'
import { DrawingsTab } from '../tabs/DrawingsTab'
import { LaborTab } from '../tabs/LaborTab'
import { MachinesTab } from '../tabs/MachinesTab'
import { OverviewTab } from '../tabs/OverviewTab'
import { PreviewTab } from '../tabs/PreviewTab'
import { PricesTab } from '../tabs/PricesTab'
import { PricingTab } from '../tabs/PricingTab'
import { QuotationTab } from '../tabs/QuotationTab'
import { RevisionsTab } from '../tabs/RevisionsTab'
import { ServicesTab } from '../tabs/ServicesTab'

const TABS = [
  { id: 'overview', label: 'Overview', C: OverviewTab },
  { id: 'drawings', label: 'Drawings', C: DrawingsTab },
  { id: 'bom', label: 'BOM / Parts', C: BomTab },
  { id: 'prices', label: 'Prices', C: PricesTab },
  { id: 'labor', label: 'Labor', C: LaborTab },
  { id: 'machines', label: 'Machines', C: MachinesTab },
  { id: 'services', label: 'Services', C: ServicesTab },
  { id: 'pricing', label: 'Items & pricing', C: PricingTab },
  { id: 'quotation', label: 'Quotation', C: QuotationTab },
  { id: 'preview', label: 'Preview & export', C: PreviewTab },
  { id: 'revisions', label: 'Revisions', C: RevisionsTab },
  { id: 'ai', label: 'AI assistant', C: AiTab },
  { id: 'actuals', label: 'Actuals', C: ActualsTab },
] as const

export function Workspace() {
  const { id, tab } = useParams()
  const pid = Number(id)
  if (!pid) return <Navigate to="/projects" replace />
  if (!tab || !TABS.some((t) => t.id === tab)) return <Navigate to={`/projects/${pid}/overview`} replace />
  return (
    <ProjectEditorProvider key={pid} id={pid}>
      <WorkspaceInner tab={tab} />
    </ProjectEditorProvider>
  )
}

function WorkspaceInner({ tab }: { tab: string }) {
  const ed = useEditor()
  const [showIssues, setShowIssues] = useState(false)
  const [issueDlg, setIssueDlg] = useState(false)
  const Active = TABS.find((t) => t.id === tab)!.C
  const stick = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stick.current
    if (!el) return
    const set = () => el.parentElement?.style.setProperty('--stick', `${el.offsetHeight}px`)
    const ro = new ResizeObserver(set)
    ro.observe(el)
    set()
    return () => ro.disconnect()
  }, [])
  const f = ed.fields
  const open = ed.issues.filter((i) => i.severity === 'missing' || i.severity === 'error')
  const warn = ed.issues.filter((i) => i.severity === 'warning' || i.severity === 'info')
  return (
    <div className="ws">
      <div className="ws-sticky" ref={stick}>
      <header className="ws-head">
        <div className="ws-title">
          <Link to="/projects" className="crumb">Projects</Link>
          <span className="crumb-sep">/</span>
          <h1 data-testid="ws-job">{f.job_no || `Project #${ed.id}`}</h1>
          <span className="ws-sub" title={ed.qd.quotation_no}>{f.quotation_no}</span>
          <span className="ws-cust">{f.customer_name}</span>
        </div>
        <div className="ws-actions">
          <select className="inp status-sel" value={f.status} onChange={(e) => ed.setField('status', e.target.value)} aria-label="Project status">
            {[...new Set([...STATUSES, f.status])].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <div className="net" title="Net total price">
            <span className="net-label">Net total</span>
            <span className="net-val num">{ed.calculating ? <Spinner /> : null}<button className="calc-plain" onClick={() => ed.openTrace('totals.net')} data-calc="totals.net"><span className="fx">ƒ</span> {fmt(ed.result.totals.net)}</button> <span className="unit">{ed.result.totals.currency}</span></span>
          </div>
          <button className={`issues-btn${open.length ? ' has' : ''}`} onClick={() => setShowIssues((s) => !s)} data-testid="issues-badge" aria-expanded={showIssues} title="Open questions / missing information">
            <span className="count">{open.length}</span> {open.length === 1 ? 'open question' : 'open questions'}
            {warn.length > 0 && <Badge tone="amber">{warn.length} warn</Badge>}
          </button>
          <span className={`dirty${ed.dirty ? ' on' : ''}`} data-testid="dirty-indicator">{ed.dirty ? '● Unsaved changes' : '✓ Saved'}</span>
          <button className="btn primary" onClick={() => void ed.save()} disabled={ed.saving || !ed.dirty} data-testid="save-btn">{ed.saving ? 'Saving…' : 'Save'}</button>
          <button className="btn" onClick={() => setIssueDlg(true)} data-testid="issue-revision-btn">Issue revision…</button>
        </div>
      </header>
      {ed.calcError && <div className="alert err slim">Live recalculation failed: {ed.calcError}</div>}
      <nav className="tabbar" role="tablist" aria-label="Project sections">
        {TABS.map((t) => (
          <Link key={t.id} to={ed.tabPath(t.id)} role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'on' : ''} data-tab={t.id}>
            {t.label}
          </Link>
        ))}
      </nav>
      </div>
      <div className="ws-body">
        <div className="ws-content" data-tab-content={tab}>
          <Active />
        </div>
        {showIssues && (
          <aside className="issues-panel" aria-label="Open questions and missing information" data-testid="issues-panel">
            <header>
              <h3>Open questions / missing information</h3>
              <button className="icon-btn" onClick={() => setShowIssues(false)} aria-label="Close">✕</button>
            </header>
            {ed.issues.length === 0 && <p className="muted">No open questions — all required inputs are provided.</p>}
            {open.length > 0 && <><h4>Must resolve ({open.length})</h4><IssueList issues={open} onPick={ed.focus} /></>}
            {warn.length > 0 && <><h4>Warnings ({warn.length})</h4><IssueList issues={warn} onPick={ed.focus} /></>}
            <p className="muted small">Click an item to jump to the field. Values are never filled in automatically.</p>
          </aside>
        )}
      </div>
      {issueDlg && <IssueRevisionModal onClose={() => setIssueDlg(false)} />}
    </div>
  )
}
