// Project editor state: estimate + quote document drafts, live recalculation, save, issues, trace drawer, focus-by-path.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UNSAFE_NavigationContext, useLocation, useNavigate } from 'react-router-dom'
import { api, errMsg } from './api/client'
import type { CalcResult, Estimate, Issue, ProjectFull, QuoteDoc, TraceNode } from './api/types'
import { IssueCtx } from './components/fields'
import { Spinner, useToast } from './components/ui'
import { fmtN } from './lib/format'
import { tabForPath } from './lib/path'

export interface ProjectFields {
  job_no: string
  quotation_no: string
  customer_name: string
  product_subject: string
  drawing_no: string
  status: string
  job_class: string
}
const MIRRORED: (keyof ProjectFields)[] = ['job_no', 'quotation_no', 'customer_name', 'product_subject', 'drawing_no']

export interface Editor {
  id: number
  proj: ProjectFull
  est: Estimate
  qd: QuoteDoc
  fields: ProjectFields
  result: CalcResult
  calculating: boolean
  calcError: string | null
  dirty: boolean
  saving: boolean
  issues: Issue[]
  edit: (fn: (e: Estimate) => void) => void
  editQd: (fn: (q: QuoteDoc) => void) => void
  setField: <K extends keyof ProjectFields>(k: K, v: ProjectFields[K]) => void
  save: () => Promise<boolean>
  /** Re-read the project from the server; resets local drafts only when there are no unsaved edits (or force). */
  reload: (force?: boolean) => Promise<void>
  openTrace: (key: string) => void
  focus: (path: string) => void
  focusPath: string | null
  tabPath: (tab: string, focus?: string) => string
}

const EditorCtx = createContext<Editor | null>(null)
export function useEditor(): Editor {
  const e = useContext(EditorCtx)
  if (!e) throw new Error('useEditor outside ProjectEditorProvider')
  return e
}

const toFields = (p: ProjectFull): ProjectFields => ({
  job_no: p.job_no || '',
  quotation_no: p.quotation_no || '',
  customer_name: p.customer_name || '',
  product_subject: p.product_subject || '',
  drawing_no: p.drawing_no || '',
  status: p.status,
  job_class: p.job_class || '',
})
const snapOf = (est: Estimate, qd: QuoteDoc, f: ProjectFields) => JSON.stringify([est, qd, f])

export function ProjectEditorProvider({ id, children }: { id: number; children: ReactNode }) {
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [proj, setProj] = useState<ProjectFull | null>(null)
  const [est, setEst] = useState<Estimate | null>(null)
  const [qd, setQd] = useState<QuoteDoc | null>(null)
  const [fields, setFields] = useState<ProjectFields | null>(null)
  const [result, setResult] = useState<CalcResult | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState<string | null>(null)
  const [snap, setSnap] = useState('')
  const [saving, setSaving] = useState(false)
  const [traceKey, setTraceKey] = useState<string | null>(null)
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const lastCalc = useRef<Estimate | null>(null)
  const seq = useRef(0)

  const applyServer = useCallback((p: ProjectFull) => {
    setProj(p)
    setEst(p.estimate)
    setQd(p.quote_doc)
    const f = toFields(p)
    setFields(f)
    setResult(p.result)
    lastCalc.current = p.estimate
    setSnap(snapOf(p.estimate, p.quote_doc, f))
  }, [])

  useEffect(() => {
    let alive = true
    setProj(null)
    api
      .get<ProjectFull>(`/api/projects/${id}`)
      .then((p) => alive && applyServer(p))
      .catch((e) => alive && setLoadErr(errMsg(e)))
    return () => {
      alive = false
    }
  }, [id, applyServer])

  // ---- live recalculation (debounced)
  useEffect(() => {
    if (!est || est === lastCalc.current) return
    const my = ++seq.current
    setCalculating(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.post<CalcResult>('/api/calculate', est)
        if (my !== seq.current) return
        lastCalc.current = est
        setResult(r)
        setCalcError(null)
      } catch (e) {
        if (my === seq.current) setCalcError(errMsg(e))
      } finally {
        if (my === seq.current) setCalculating(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [est])

  const dirty = useMemo(() => (est && qd && fields ? snapOf(est, qd, fields) !== snap : false), [est, qd, fields, snap])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Ctrl/Cmd+S saves
  const saveRef = useRef<() => Promise<boolean>>(async () => false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Leaving the project (sidebar, links) with unsaved edits asks for confirmation; moving between its tabs does not.
  const { navigator } = useContext(UNSAFE_NavigationContext)
  useEffect(() => {
    if (!dirty) return
    const nav = navigator as unknown as { push: (...a: unknown[]) => void; replace: (...a: unknown[]) => void }
    const { push, replace } = nav
    const guard = (orig: (...a: unknown[]) => void) => (...a: unknown[]) => {
      const to = a[0] as string | { pathname?: string }
      const path = typeof to === 'string' ? to : to.pathname || ''
      if (path.startsWith(`/projects/${id}`) || window.confirm('This project has unsaved changes that will be lost. Leave without saving?')) orig(...a)
    }
    nav.push = guard(push.bind(navigator))
    nav.replace = guard(replace.bind(navigator))
    return () => {
      nav.push = push
      nav.replace = replace
    }
  }, [dirty, navigator, id])

  const edit = useCallback((fn: (e: Estimate) => void) => {
    setEst((prev) => {
      if (!prev) return prev
      const d = structuredClone(prev)
      fn(d)
      return d
    })
  }, [])
  const editQd = useCallback((fn: (q: QuoteDoc) => void) => {
    setQd((prev) => {
      if (!prev) return prev
      const d = structuredClone(prev)
      fn(d)
      return d
    })
  }, [])
  const setField = useCallback(<K extends keyof ProjectFields>(k: K, v: ProjectFields[K]) => {
    setFields((f) => (f ? { ...f, [k]: v } : f))
    if (MIRRORED.includes(k)) setQd((q) => (q ? { ...q, [k]: v } : q))
  }, [])

  const save = useCallback(async () => {
    if (!est || !qd || !fields) return false
    setSaving(true)
    try {
      const sent = snapOf(est, qd, fields)
      const p = await api.put<ProjectFull>(`/api/projects/${id}`, { ...fields, estimate: est, quote_doc: qd })
      setProj(p)
      setResult(p.result)
      lastCalc.current = est
      setSnap(sent)
      toast.ok('Project saved')
      return true
    } catch (e) {
      toast.err(e)
      return false
    } finally {
      setSaving(false)
    }
  }, [est, qd, fields, id, toast])

  useEffect(() => {
    saveRef.current = save
  }, [save])

  const reload = useCallback(
    async (force = false) => {
      const p = await api.get<ProjectFull>(`/api/projects/${id}`)
      if (force || !dirty) applyServer(p)
      else {
        // keep local drafts; refresh the server-owned collections only
        setProj((cur) => (cur ? { ...cur, drawings: p.drawings, revisions: p.revisions, actuals: p.actuals, meta: p.meta, updated_at: p.updated_at } : p))
      }
    },
    [id, dirty, applyServer],
  )

  // ---- issues / focus
  const issues = result?.issues
  const byPath = useMemo(() => {
    const m = new Map<string, Issue[]>()
    for (const i of issues || []) {
      const l = m.get(i.path)
      if (l) l.push(i)
      else m.set(i.path, [i])
    }
    return m
  }, [issues])

  const tabPath = useCallback((tab: string, focus?: string) => `/projects/${id}/${tab}${focus ? `?focus=${encodeURIComponent(focus)}` : ''}`, [id])

  const normPath = useCallback(
    (p: string) => {
      // price_sheets.<sheetId> -> price_sheets.<index>
      const m = /^price_sheets\.([^.]+)(.*)$/.exec(p)
      if (m && est && !/^\d+$/.test(m[1])) {
        const idx = est.price_sheets.findIndex((s) => s.id === m[1])
        if (idx >= 0) return `price_sheets.${idx}${m[2]}`
      }
      return p
    },
    [est],
  )

  const focus = useCallback(
    (path: string) => {
      const p = normPath(path)
      navigate(tabPath(tabForPath(p), p), { state: { n: Date.now() } })
    },
    [navigate, tabPath, normPath],
  )

  const openTrace = useCallback((k: string) => setTraceKey(k), [])

  // flash the target field after navigation
  const nodesRef = useRef<CalcResult['nodes']>({})
  useEffect(() => {
    nodesRef.current = result?.nodes || {}
  }, [result])
  useEffect(() => {
    const fp = new URLSearchParams(location.search).get('focus')
    if (!fp) return
    setFocusPath(fp)
    const timers: number[] = []
    let done = false
    const tryFind = (final: boolean) => {
      if (done) return
      const esc = (s: string) => s.replace(/"/g, '\\"')
      let el = document.querySelector<HTMLElement>(`[data-path="${esc(fp)}"]`)
      if (!el) el = document.querySelector<HTMLElement>(`[data-row="${esc(fp)}"]`)
      if (!el) el = document.querySelector<HTMLElement>(`[data-path^="${esc(fp)}."]`)
      if (!el) {
        // walk up the path: parts.5.processes.0.hours -> parts.5.processes.0 -> parts.5
        const segs = fp.split('.')
        for (let n = segs.length - 1; n > 1 && !el; n--) el = document.querySelector<HTMLElement>(`[data-row="${esc(segs.slice(0, n).join('.'))}"]`)
      }
      if (el) {
        done = true
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('flash')
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true })
        timers.push(window.setTimeout(() => el!.classList.remove('flash'), 3000))
      } else if (final && nodesRef.current[fp]) {
        setTraceKey(fp)
      }
    }
    for (const [i, ms] of [80, 250, 600, 1200].entries()) timers.push(window.setTimeout(() => tryFind(i === 3), ms))
    return () => timers.forEach(clearTimeout)
  }, [location.key, location.search])

  const issueCtx = useMemo(() => ({ byPath, nodes: result?.nodes || {}, openTrace }), [byPath, result, openTrace])

  if (loadErr) return <div className="page"><div className="alert err">Could not load project #{id}: {loadErr}</div></div>
  if (!proj || !est || !qd || !fields || !result) return <div className="page"><Spinner label="Loading project…" /></div>

  const value: Editor = {
    id, proj, est, qd, fields, result, calculating, calcError, dirty, saving, issues: result.issues,
    edit, editQd, setField, save, reload, openTrace, focus, focusPath, tabPath,
  }
  return (
    <EditorCtx.Provider value={value}>
      <IssueCtx.Provider value={issueCtx}>
        {children}
        {traceKey && <TraceDrawer k={traceKey} est={est} result={result} onClose={() => setTraceKey(null)} onNav={setTraceKey} />}
      </IssueCtx.Provider>
    </EditorCtx.Provider>
  )
}

// ------------------------------------------------------------------ trace drawer
function TraceDrawer({ k, est, result, onClose, onNav }: { k: string; est: Estimate; result: CalcResult; onClose: () => void; onNav: (k: string) => void }) {
  const [tree, setTree] = useState<TraceNode | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .post<TraceNode>('/api/trace', { estimate: est, key: k, depth: 8 })
      .then((t) => alive && (setTree(t), setErr(null)))
      .catch((e) => alive && setErr(errMsg(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // result identity changes after every recalculation -> keep the trace live while editing
  }, [k, est, result])
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  useEffect(() => setHistory((h) => (h[h.length - 1] === k ? h : [...h.slice(-6), k])), [k])
  return (
    <aside className="drawer" aria-label="Calculation trace" data-testid="trace-drawer">
      <header className="drawer-head">
        <div>
          <h3>Calculation trace</h3>
          <code className="muted small">{k}</code>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close trace">
          ✕
        </button>
      </header>
      {history.length > 1 && (
        <div className="trace-crumbs">
          {history.slice(0, -1).map((h, i) => (
            <button key={i} className="link small" onClick={() => onNav(h)}>
              ← {h}
            </button>
          ))}
        </div>
      )}
      <div className="drawer-body">
        {loading && !tree && <Spinner label="Tracing…" />}
        {err && <div className="alert err">{err}</div>}
        {tree && <TraceBranch n={tree} depth={0} onFocus={onNav} />}
        <p className="muted small" style={{ marginTop: 16 }}>
          Every number is derived from the inputs shown below it. Red = missing input. Click “trace” on a node to re-root the trace there.
        </p>
      </div>
    </aside>
  )
}

function TraceBranch({ n, depth, onFocus }: { n: TraceNode; depth: number; onFocus: (k: string) => void }) {
  const [open, setOpen] = useState(depth < 3)
  const has = n.children.length > 0
  const isInput = n.kind === 'input' || n.kind === 'setting'
  return (
    <div className={`tn${n.missing ? ' missing' : ''}`} data-key={n.key}>
      <div className="tn-row">
        <button className="tn-toggle" onClick={() => setOpen(!open)} disabled={!has} aria-label={open ? 'Collapse' : 'Expand'}>
          {has ? (open ? '▾' : '▸') : '·'}
        </button>
        <span className="tn-label">{n.label}</span>
        <span className="tn-val num">
          {n.missing ? <em>missing</em> : fmtN(n.value, 4)}
          {n.unit ? <span className="unit"> {n.unit}</span> : null}
        </span>
        <span className={`tn-kind ${n.kind || ''}`}>{isInput ? n.kind : 'calc'}</span>
        {depth > 0 && has && (
          <button className="link small" onClick={() => onFocus(n.key)} title="Re-root the trace here">
            trace
          </button>
        )}
      </div>
      <div className="tn-detail">
        {n.formula && <div><span className="lbl">formula</span> {n.formula}</div>}
        {n.expr && <div><span className="lbl">values</span> <code>{n.expr}</code></div>}
        {n.source && <div><span className="lbl">source</span> {n.source}</div>}
        {n.missing && <div className="miss-msg">Missing input — provide this value (never estimated automatically).</div>}
      </div>
      {open && has && (
        <div className="tn-children">
          {n.children.map((c, i) => (
            <TraceBranch key={c.key + i} n={c} depth={depth + 1} onFocus={onFocus} />
          ))}
        </div>
      )}
    </div>
  )
}
