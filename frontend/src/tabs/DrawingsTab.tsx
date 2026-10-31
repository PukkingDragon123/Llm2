import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, runJob } from '../api/client'
import type { Drawing, DrawingExtraction, DrawingReview, ExtField, ExtPart, Loc, PartReview } from '../api/types'
import { DrawingViewer } from '../components/DrawingViewer'
import type { Highlight } from '../components/DrawingViewer'
import { NumIn, SelIn, TextIn } from '../components/fields'
import { Badge, Card, Empty, ErrorBox, Spinner, Tabs, useToast } from '../components/ui'
import { useEditor } from '../editor'
import { fmtDate } from '../lib/format'

const LOW = 0.8
const FORMS = ['plate', 'pipe', 'tube', 'bar', 'forging', 'flange', 'fitting', 'gasket', 'bolt', 'other']
type Sec = 'parts' | 'nozzles' | 'unclear' | 'design' | 'dims' | 'title' | 'other'

const hasExt = (d: Drawing): d is Drawing & { extraction: DrawingExtraction } => !!d.extraction && 'parts' in d.extraction

export function DrawingsTab() {
  const ed = useEditor()
  const { proj, id, reload } = ed
  const toast = useToast()
  const [sel, setSel] = useState<number | null>(proj.drawings[0]?.id ?? null)
  const [upErr, setUpErr] = useState<unknown>(null)
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const d = proj.drawings.find((x) => x.id === sel) ?? proj.drawings[0] ?? null

  useEffect(() => { if (!d && proj.drawings[0]) setSel(proj.drawings[0].id) }, [d, proj.drawings])

  async function upload(f: File) {
    setUploading(true)
    setUpErr(null)
    try {
      const r = await api.upload<Drawing>(`/api/projects/${id}/drawings`, f)
      await reload()
      setSel(r.id)
      toast.ok(`Uploaded ${f.name} (${r.pages} page${r.pages === 1 ? '' : 's'})`)
    } catch (e) {
      setUpErr(e)
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ''
    }
  }
  async function del(x: Drawing) {
    if (!window.confirm(`Delete drawing "${x.filename}" and its extraction/review?`)) return
    try {
      await api.del(`/api/drawings/${x.id}`)
      await reload()
      setSel(null)
    } catch (e) {
      toast.err(e)
    }
  }

  return (
    <div className="stack">
      <Card
        title="Drawings"
        actions={
          <>
            <input ref={file} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/*" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} data-testid="drawing-file" />
            <button className="btn primary" onClick={() => file.current?.click()} disabled={uploading} data-testid="upload-drawing">{uploading ? 'Uploading…' : '+ Upload drawing (PDF / PNG / JPG)'}</button>
          </>
        }
      >
        <ErrorBox error={upErr} />
        {proj.drawings.length === 0 && !uploading && <Empty>No drawings yet. Upload a customer or as-built drawing, then let Claude extract the parts list, nozzles and design data for engineer review.</Empty>}
        {uploading && <Spinner label="Uploading…" />}
        <div className="dwg-list">
          {proj.drawings.map((x) => (
            <button key={x.id} className={`dwg-chip${d?.id === x.id ? ' on' : ''}`} onClick={() => setSel(x.id)} data-testid="drawing-chip">
              <strong>{x.filename}</strong>
              <span className="muted small">{x.pages} p · {x.status} · {fmtDate(x.created_at)}</span>
            </button>
          ))}
        </div>
      </Card>
      {d && <DrawingWorkbench key={d.id} d={d} onDelete={() => void del(d)} />}
    </div>
  )
}

function DrawingWorkbench({ d, onDelete }: { d: Drawing; onDelete: () => void }) {
  const ed = useEditor()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [hl, setHl] = useState<Highlight | null>(null)
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [review, setReview] = useState<DrawingReview>(d.review || {})
  const [rdirty, setRdirty] = useState(false)
  const [sec, setSec] = useState<Sec>('parts')
  const [editing, setEditing] = useState<Set<number>>(new Set())
  const seq = useRef(0)

  const ext = hasExt(d) ? d.extraction : null
  useEffect(() => { setReview(d.review || {}); setRdirty(false) }, [d.review, d.extraction])

  function show(loc: Loc | null | undefined, label: string) {
    if (!loc || !loc.bbox || loc.bbox.length < 4) return
    setPage(loc.page)
    setHl({ page: loc.page, bbox: loc.bbox, n: ++seq.current, label })
  }

  async function analyze() {
    setBusy(true)
    setErr(null)
    try {
      await runJob(api.post<{ job_id: string }>(`/api/drawings/${d.id}/analyze`, { context }))
      await ed.reload()
      toast.ok('Drawing analysed — review the extracted data')
    } catch (e) {
      setErr(e)
      if (!(e instanceof ApiError && e.isAiUnavailable)) void ed.reload().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  const setPart = (i: number, fn: (p: PartReview) => PartReview) => {
    setReview((r) => ({ ...r, parts: { ...(r.parts || {}), [i]: fn((r.parts || {})[i] || { status: 'accepted' }) } }))
    setRdirty(true)
  }
  const decide = (i: number, status: PartReview['status']) => setPart(i, (p) => ({ ...p, status }))
  const edit = (i: number, field: keyof ExtPart, v: unknown) => setPart(i, (p) => ({ status: 'edited', values: { ...(p.values || {}), [field]: v } }))
  const counts = useMemo(() => {
    const parts = review.parts || {}
    const v = Object.values(parts)
    return { accepted: v.filter((x) => x.status === 'accepted').length, edited: v.filter((x) => x.status === 'edited').length, rejected: v.filter((x) => x.status === 'rejected').length }
  }, [review.parts])

  async function saveReview(complete?: boolean): Promise<boolean> {
    try {
      const body: DrawingReview = { ...review, complete: complete ?? review.complete ?? false }
      await api.put(`/api/drawings/${d.id}/review`, body)
      setReview(body)
      setRdirty(false)
      await ed.reload()
      toast.ok(complete ? 'Review saved and marked complete' : 'Review saved')
      return true
    } catch (e) {
      toast.err(e)
      return false
    }
  }
  async function toBom() {
    if (rdirty && !(await saveReview())) return
    if (ed.dirty) {
      if (!window.confirm('The project has unsaved changes. Save them before adding the accepted parts to the BOM?')) return
      if (!(await ed.save())) return
    }
    try {
      const r = await api.post<{ added: string[]; not_accepted: number[]; result_missing: number }>(`/api/drawings/${d.id}/to-bom`)
      await ed.reload(true)
      toast.ok(`${r.added.length} part(s) added to the BOM, ${r.not_accepted.length} not accepted. ${r.result_missing} missing input(s) now.`)
    } catch (e) {
      toast.err(e)
    }
  }

  return (
    <div className="dwg-grid">
      <Card title={<>{d.filename} <Badge tone={d.status === 'error' ? 'red' : d.status === 'extracted' || d.status === 'reviewed' ? 'green' : 'gray'}>{d.status}</Badge></>} className="viewer-card" actions={<a className="btn sm" href={`/api/drawings/${d.id}/file`} target="_blank" rel="noreferrer">Open original</a>} flush>
        <DrawingViewer drawing={d} page={page} onPage={(p) => { setPage(p) }} hl={hl} />
      </Card>

      <div className="stack side-col">
        <Card title="AI extraction" actions={<button className="btn sm danger" onClick={onDelete}>Delete drawing</button>}>
          <label className="field wide"><span className="field-label">Context for Claude (optional)</span>
            <textarea className="inp" rows={2} value={context} onChange={(e) => setContext(e.target.value)} placeholder="e.g. Customer drawing, red marks override printed values. Material is Ti Gr.2." />
          </label>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => void analyze()} disabled={busy} data-testid="analyze-btn">{busy ? 'Analysing…' : ext ? 'Re-analyze with Claude' : 'Analyze with Claude'}</button>
            {d.ai_meta && <span className="muted small">{String(d.ai_meta.model || '')} · {String(d.ai_meta.images ?? '')} images</span>}
          </div>
          {busy && <Spinner label="Claude is reading the drawing (overview + zoomed tiles)… this can take a few minutes" />}
          <ErrorBox error={err} />
          {d.status === 'error' && d.error && !err && <div className="alert err">Last analysis failed: {d.error}</div>}
          {!ext && !busy && <p className="muted small">Not analysed yet. Claude extracts title block, design data, dimensions, parts, nozzles and unclear items — every row with its location on the drawing for verification.</p>}
          {ext && <p className="small"><strong>{ext.drawing_type.replace(/_/g, ' ')}</strong> — {ext.summary}</p>}
        </Card>

        {ext && (
          <Card title="Engineer review" flush>
            <div style={{ padding: '0 12px' }}>
              <Tabs<Sec>
                value={sec}
                onChange={setSec}
                tabs={[
                  { id: 'parts', label: <>Parts <Badge>{ext.parts.length}</Badge></> },
                  { id: 'nozzles', label: <>Nozzles <Badge>{ext.nozzles.length}</Badge></> },
                  { id: 'unclear', label: <>Unclear <Badge tone={ext.unclear_items.length ? 'amber' : 'gray'}>{ext.unclear_items.length}</Badge></> },
                  { id: 'design', label: 'Design data' },
                  { id: 'dims', label: 'Dimensions' },
                  { id: 'title', label: 'Title block' },
                  { id: 'other', label: 'Notes / NDE' },
                ]}
              />
            </div>
            <div className="review-body">
              {sec === 'parts' && (
                <>
                  <div className="btn-row" style={{ marginBottom: 8 }}>
                    <button className="btn sm" onClick={() => { ext.parts.forEach((p, i) => { if (!review.parts?.[i] && p.confidence >= LOW && !p.unclear_fields.length) decide(i, 'accepted') }) }} title="Accept rows with confidence ≥ 0.8 and no unclear fields">Accept all high-confidence</button>
                    <span className="muted small">{counts.accepted} accepted · {counts.edited} edited · {counts.rejected} rejected · {ext.parts.length - counts.accepted - counts.edited - counts.rejected} undecided</span>
                  </div>
                  <div className="dt-scroll" style={{ maxHeight: 'calc(100vh - 420px)' }}>
                    <table className="dt compact parts-review" data-testid="extracted-parts">
                      <thead><tr><th>Part</th><th>Material spec</th><th>Form</th><th className="r">Thk</th><th className="r">Width</th><th className="r">Length</th><th className="r">OD</th><th className="r">Qty</th><th>Notes</th><th>Conf.</th><th>Review</th></tr></thead>
                      <tbody>
                        {ext.parts.map((p, i) => {
                          const rv = review.parts?.[i]
                          const val = <K extends keyof ExtPart>(k: K): ExtPart[K] => ((rv?.values && k in rv.values ? rv.values[k] : p[k]) as ExtPart[K])
                          const isEd = editing.has(i)
                          const low = p.confidence < LOW || p.unclear_fields.length > 0
                          const unc = (f: string) => p.unclear_fields.includes(f)
                          const num = (k: 'thk_mm' | 'width_mm' | 'length_mm' | 'od_mm' | 'qty') =>
                            isEd ? <NumIn value={val(k) as number | null} ariaLabel={k} onChange={(v) => edit(i, k, v)} className={unc(k) ? 'unc' : ''} /> : <span className={`${unc(k) ? 'unc-text' : ''}`}>{val(k) ?? '—'}</span>
                          return (
                            <tr key={i} className={`${low ? 'lowconf' : ''} st-${rv?.status || 'none'}${hl && p.location && hl.bbox === p.location.bbox ? ' active' : ''}`} data-row={`drawing.parts.${i}`}>
                              <td className="clk" onClick={() => show(p.location, p.name)} title={p.location ? 'Show on drawing' : 'No location'}>
                                {isEd ? <TextIn value={val('name')} onChange={(v) => edit(i, 'name', v)} ariaLabel="name" /> : <><strong>{val('name')}</strong>{p.mark ? <span className="muted small"> [{p.mark}]</span> : null}</>}
                                {p.location && <span className="pin" aria-hidden> ◎</span>}
                              </td>
                              <td>{isEd ? <TextIn value={val('material_spec') ?? ''} onChange={(v) => edit(i, 'material_spec', v)} ariaLabel="material_spec" className={unc('material_spec') ? 'unc' : ''} /> : <span className={unc('material_spec') ? 'unc-text' : ''}>{val('material_spec') ?? '—'}</span>}</td>
                              <td>{isEd ? <SelIn value={val('form')} options={FORMS.map((f) => ({ value: f, label: f }))} onChange={(v) => edit(i, 'form', v)} /> : val('form')}</td>
                              <td className="r">{num('thk_mm')}</td><td className="r">{num('width_mm')}</td><td className="r">{num('length_mm')}</td><td className="r">{num('od_mm')}</td><td className="r">{num('qty')}</td>
                              <td>{isEd ? <TextIn value={val('notes') ?? ''} onChange={(v) => edit(i, 'notes', v)} ariaLabel="notes" /> : <span className="small">{val('notes')}</span>}</td>
                              <td><Badge tone={low ? 'amber' : 'green'} title={p.unclear_fields.length ? `Unclear: ${p.unclear_fields.join(', ')}` : undefined}>{Math.round(p.confidence * 100)}%</Badge></td>
                              <td className="review-btns">
                                <button className={`tg ok${rv?.status === 'accepted' ? ' on' : ''}`} onClick={() => decide(i, 'accepted')} title="Accept" data-testid="accept-part">✓</button>
                                <button className={`tg${isEd ? ' on' : ''}`} onClick={() => setEditing((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })} title="Edit values" data-testid="edit-part">✎</button>
                                <button className={`tg no${rv?.status === 'rejected' ? ' on' : ''}`} onClick={() => decide(i, 'rejected')} title="Reject" data-testid="reject-part">✕</button>
                                {rv?.status === 'edited' && <Badge tone="blue">edited</Badge>}
                              </td>
                            </tr>
                          )
                        })}
                        {ext.parts.length === 0 && <tr><td colSpan={11} className="empty-cell">No parts extracted</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {sec === 'nozzles' && (
                <div className="dt-scroll"><table className="dt compact">
                  <thead><tr><th>Mark</th><th>Service</th><th>Size</th><th>Sch/Thk</th><th>Rating</th><th>Facing</th><th>Type</th><th className="r">Qty</th><th>Conf.</th></tr></thead>
                  <tbody>
                    {ext.nozzles.map((n, i) => (
                      <tr key={i} className={n.confidence < LOW ? 'lowconf' : ''}>
                        <td className="clk" onClick={() => show(n.location, `Nozzle ${n.mark}`)}><strong>{n.mark}</strong>{n.location && <span className="pin"> ◎</span>}</td>
                        <td>{n.service}</td><td>{n.size}</td><td>{n.schedule_or_thk}</td><td>{n.flange_rating}</td><td>{n.facing}</td><td>{n.type}</td><td className="r">{n.qty ?? '—'}</td>
                        <td><Badge tone={n.confidence < LOW ? 'amber' : 'green'}>{Math.round(n.confidence * 100)}%</Badge></td>
                      </tr>
                    ))}
                    {ext.nozzles.length === 0 && <tr><td colSpan={9} className="empty-cell">No nozzles extracted</td></tr>}
                  </tbody>
                </table></div>
              )}
              {sec === 'unclear' && (
                <div className="unclear-list">
                  {ext.unclear_items.map((u, i) => (
                    <div key={i} className="unclear" data-row={`drawing.unclear.${i}`}>
                      <div className="clk" onClick={() => show(u.location, u.field)}><Badge tone="amber">{u.field}</Badge> {u.description} {u.location && <span className="pin">◎ show</span>}</div>
                      <div className="q">❓ {u.question}</div>
                      <textarea className="inp" rows={2} placeholder="Engineer's answer…" value={review.unclear?.[i]?.answer ?? ''} aria-label={`Answer ${i + 1}`} onChange={(e) => { const v = e.target.value; setReview((r) => ({ ...r, unclear: { ...(r.unclear || {}), [i]: { answer: v } } })); setRdirty(true) }} />
                    </div>
                  ))}
                  {ext.unclear_items.length === 0 && <Empty>No unclear items reported.</Empty>}
                </div>
              )}
              {sec === 'design' && <FieldTable rows={ext.design_data} show={show} />}
              {sec === 'dims' && <FieldTable rows={ext.main_dimensions} show={show} />}
              {sec === 'title' && <FieldTable rows={ext.title_block} show={show} />}
              {sec === 'other' && (
                <>
                  <h4>Welding &amp; NDE</h4><FieldTable rows={ext.welding_and_nde} show={show} />
                  <h4>Surface finish &amp; painting</h4><FieldTable rows={ext.surface_finish_and_painting} show={show} />
                  <h4>General notes</h4><ul className="notes">{ext.general_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </>
              )}
            </div>
            <div className="review-foot">
              <label className="chk"><input type="checkbox" checked={!!review.complete} onChange={(e) => { setReview((r) => ({ ...r, complete: e.target.checked })); setRdirty(true) }} /> review complete</label>
              <span className="grow" />
              {rdirty && <span className="dirty on small">● unsaved review</span>}
              <button className="btn" onClick={() => void saveReview()} disabled={!rdirty} data-testid="save-review">Save review</button>
              <button className="btn primary" onClick={() => void toBom()} disabled={counts.accepted + counts.edited === 0} title="Appends accepted / edited parts to the project BOM" data-testid="to-bom">Add accepted parts to BOM ({counts.accepted + counts.edited})</button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function FieldTable({ rows, show }: { rows: ExtField[]; show: (l: Loc | null | undefined, label: string) => void }) {
  if (!rows.length) return <Empty>Nothing extracted.</Empty>
  return (
    <table className="dt compact">
      <thead><tr><th>Field</th><th>Value</th><th>Unit</th><th>Conf.</th></tr></thead>
      <tbody>
        {rows.map((f, i) => (
          <tr key={i} className={f.confidence < LOW ? 'lowconf' : ''}>
            <td className="clk" onClick={() => show(f.location, f.key)}>{f.key}{f.location && <span className="pin"> ◎</span>}</td>
            <td>{f.value}</td><td>{f.unit}</td>
            <td><Badge tone={f.confidence < LOW ? 'amber' : 'green'}>{Math.round(f.confidence * 100)}%</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
