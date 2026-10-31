import { useState } from 'react'
import { api, runJob } from '../api/client'
import type { QuoteDraft, QuoteRow, RowKind, Run } from '../api/types'
import { NumIn, SelIn, TextIn } from '../components/fields'
import { QuotePreview, RunsView, rowText } from '../components/QuotePreview'
import { Badge, Card, ErrorBox, Field, Spinner, useToast } from '../components/ui'
import { useEditor } from '../editor'
import { moveItem } from '../lib/path'

const KINDS: { value: RowKind; label: string }[] = [
  { value: 'item', label: 'Item heading (green)' },
  { value: 'line', label: 'Line' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'blank', label: 'Blank' },
  { value: 'highlight_head', label: 'Highlight heading (yellow)' },
  { value: 'highlight_line', label: 'Highlight line (yellow)' },
  { value: 'section_head', label: 'Section heading' },
  { value: 'text', label: 'Text' },
]
const RED = 'FFFF0000'
const normRun = (r: Partial<Run>): Run => ({ text: r.text ?? '', bold: !!r.bold, italic: !!r.italic, underline: !!r.underline, color: r.color ?? null })

function RunsEditor({ runs, onChange, path }: { runs: Run[]; onChange: (r: Run[]) => void; path: string }) {
  const upd = (i: number, patch: Partial<Run>) => onChange(runs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="runs">
      {runs.map((r, i) => (
        <span key={i} className="run">
          <TextIn path={`${path}.${i}.text`} value={r.text} onChange={(v) => upd(i, { text: v })} className="run-text" ariaLabel="Run text" />
          <button className={`tg b${r.bold ? ' on' : ''}`} title="Bold" onClick={() => upd(i, { bold: !r.bold })}>B</button>
          <button className={`tg i${r.italic ? ' on' : ''}`} title="Italic" onClick={() => upd(i, { italic: !r.italic })}>I</button>
          <button className={`tg u${r.underline ? ' on' : ''}`} title="Underline" onClick={() => upd(i, { underline: !r.underline })}>U</button>
          <button className={`tg r${r.color ? ' on' : ''}`} title="Red text" onClick={() => upd(i, { color: r.color ? null : RED })}>A</button>
          {runs.length > 1 && <button className="tg x" title="Remove run" onClick={() => onChange(runs.filter((_, j) => j !== i))}>×</button>}
        </span>
      ))}
      <button className="btn sm" title="Add a text run with different formatting" onClick={() => onChange([...runs, { text: '', bold: false, italic: false, underline: false, color: null }])}>+ run</button>
    </div>
  )
}

export function QuotationTab() {
  const { qd, editQd, setField, result, est } = useEditor()
  const [sel, setSel] = useState<number | null>(null)
  const set = (k: string, v: unknown) => editQd((q) => { (q as Record<string, unknown>)[k] = v })
  const explicit = Array.isArray(qd.page_breaks)

  function shiftBreaks(q: typeof qd, from: number, delta: number) {
    if (!Array.isArray(q.page_breaks)) return
    q.page_breaks = q.page_breaks.filter((b) => !(delta < 0 && b === from)).map((b) => (b >= from ? b + delta : b))
  }
  const insertAt = (idx: number, row: QuoteRow) => editQd((q) => { q.rows.splice(idx, 0, row); shiftBreaks(q, idx + 1, 1) })
  const blank = (kind: RowKind = 'line'): QuoteRow => ({ kind, runs: kind === 'blank' ? [] : [{ text: '', bold: kind === 'item' || kind === 'section_head', italic: false, underline: kind === 'section_head', color: null }], ...(kind === 'item' ? { item_no: est.buckets[0]?.no } : {}) })

  return (
    <div className="stack">
      <Card title="Quotation header">
        <div className="form-grid cols4">
          <Field label="Quotation no."><TextIn path="quote_doc.quotation_no" value={qd.quotation_no} onChange={(v) => setField('quotation_no', v)} /></Field>
          <Field label="Job no."><TextIn path="quote_doc.job_no" value={qd.job_no} onChange={(v) => setField('job_no', v)} /></Field>
          <Field label="Customer name" wide><TextIn path="quote_doc.customer_name" value={qd.customer_name} onChange={(v) => setField('customer_name', v)} /></Field>
          <Field label="Contact person"><TextIn path="quote_doc.contact_person" value={qd.contact_person} onChange={(v) => set('contact_person', v)} /></Field>
          <Field label="Tel"><TextIn path="quote_doc.tel" value={qd.tel} onChange={(v) => set('tel', v)} /></Field>
          <Field label="Fax"><TextIn path="quote_doc.fax" value={qd.fax} onChange={(v) => set('fax', v)} /></Field>
          <Field label="E-mail"><TextIn path="quote_doc.email" value={qd.email} onChange={(v) => set('email', v)} /></Field>
          <Field label="Product subject" wide><TextIn path="quote_doc.product_subject" value={qd.product_subject} onChange={(v) => setField('product_subject', v)} /></Field>
          <Field label="Drawing no."><TextIn path="quote_doc.drawing_no" value={qd.drawing_no} onChange={(v) => setField('drawing_no', v)} /></Field>
          <Field label="Enquiry date"><TextIn type="date" path="quote_doc.enquiry_date" value={qd.enquiry_date} onChange={(v) => set('enquiry_date', v)} /></Field>
          <Field label="Quotation date"><TextIn type="date" path="quote_doc.quotation_date" value={qd.quotation_date} onChange={(v) => set('quotation_date', v)} /></Field>
          <Field label="Validity date"><TextIn type="date" path="quote_doc.validity_date" value={qd.validity_date} onChange={(v) => set('validity_date', v)} /></Field>
          <Field label="Payment term"><TextIn path="quote_doc.payment_term" value={qd.payment_term} onChange={(v) => set('payment_term', v)} /></Field>
          <Field label="Delivery time"><NumIn path="quote_doc.delivery_time" value={qd.delivery_time as never} onChange={(v) => set('delivery_time', v)} /></Field>
          <Field label="Delivery unit"><SelIn path="quote_doc.delivery_unit" value={qd.delivery_unit} options={['Days', 'Weeks', 'Months'].map((x) => ({ value: x, label: x }))} onChange={(v) => set('delivery_unit', v)} /></Field>
          <Field label="Currency label"><TextIn path="quote_doc.currency_label" value={qd.currency_label} onChange={(v) => set('currency_label', v)} /></Field>
          <Field label="Prepared by"><TextIn path="quote_doc.prepared_by" value={qd.prepared_by} onChange={(v) => set('prepared_by', v)} /></Field>
          <Field label="Reviewed by"><TextIn path="quote_doc.reviewed_by" value={qd.reviewed_by} onChange={(v) => set('reviewed_by', v)} /></Field>
          <Field label="Approved by"><TextIn path="quote_doc.approved_by" value={qd.approved_by} onChange={(v) => set('approved_by', v)} /></Field>
          <Field label="Disclaimers page"><label className="chk"><input type="checkbox" checked={qd.include_disclaimers !== false} onChange={(e) => set('include_disclaimers', e.target.checked)} /> include</label></Field>
        </div>
      </Card>

      <Card title="Title line (product line)">
        <RunsEditor path="quote_doc.title.runs" runs={qd.title.runs} onChange={(r) => editQd((q) => { q.title.runs = r })} />
        <div className="form-grid cols4" style={{ marginTop: 8 }}>
          <Field label="Quantity"><NumIn path="quote_doc.title.qty" value={qd.title.qty} onChange={(v) => editQd((q) => { q.title.qty = v })} /></Field>
          <Field label="Unit"><TextIn path="quote_doc.title.unit" value={qd.title.unit} onChange={(v) => editQd((q) => { q.title.unit = v })} /></Field>
        </div>
      </Card>

      <AiDraft sel={sel} />

      <div className="quote-split">
        <Card title={`Body rows (${qd.rows.length})`} className="quote-editor" actions={<span className="muted small">Row # = body index (title = 0), used by explicit page breaks</span>}>
          <div className="pb-ctl">
            <label className="chk"><input type="checkbox" checked={!explicit} onChange={(e) => set('page_breaks', e.target.checked ? 'auto' : [])} data-testid="pb-auto" /> Automatic page breaks</label>
            {explicit && (
              <label className="field inline"><span className="field-label">Break after body rows</span>
                <input className="inp" defaultValue={(qd.page_breaks as number[]).join(', ')} key={(qd.page_breaks as number[]).join(',')} onBlur={(e) => set('page_breaks', e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => a - b))} placeholder="e.g. 32, 60" />
              </label>
            )}
          </div>
          <div className="qrows" data-testid="quote-rows">
            {qd.rows.map((r, i) => (
              <div key={i} className={`qrow ${r.kind}${sel === i ? ' sel' : ''}`} data-row={`quote_doc.rows.${i}`} onFocus={() => setSel(i)}>
                <div className="qrow-top">
                  <span className="qidx" title="body index">{i + 1}</span>
                  <SelIn path={`quote_doc.rows.${i}.kind`} value={r.kind} options={KINDS} onChange={(v) => editQd((q) => { q.rows[i].kind = v as RowKind; if (v === 'item' && q.rows[i].item_no == null) q.rows[i].item_no = est.buckets[0]?.no })} className="kind-sel" />
                  {r.kind === 'item' && (
                    <SelIn path={`quote_doc.rows.${i}.item_no`} value={String(r.item_no ?? '')} options={est.buckets.map((b) => ({ value: String(b.no), label: `Item ${b.no}: ${b.heading}` }))} onChange={(v) => editQd((q) => { q.rows[i].item_no = v === '' ? null : Number(v) })} placeholder="item #" />
                  )}
                  <span className="grow" />
                  {(r.kind === 'line' || r.kind === 'text') && (
                    <label className="chk small" title="Indent as sub-line"><input type="checkbox" checked={!!r.indent} onChange={(e) => editQd((q) => { q.rows[i].indent = e.target.checked })} />indent</label>
                  )}
                  <label className="field inline tiny" title="Fixed row height in points (optional)"><span className="field-label">h</span>
                    <input className="inp num h-inp" type="number" min={0} value={r.height ?? ''} onChange={(e) => editQd((q) => { q.rows[i].height = e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  {explicit && (
                    <button className={`tg${(qd.page_breaks as number[]).includes(i + 1) ? ' on' : ''}`} title="Page break after this row" onClick={() => editQd((q) => { const pb = q.page_breaks as number[]; q.page_breaks = pb.includes(i + 1) ? pb.filter((x) => x !== i + 1) : [...pb, i + 1].sort((a, b) => a - b) })}>⤓</button>
                  )}
                  <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => editQd((q) => { q.rows = moveItem(q.rows, i, i - 1) })}>↑</button>
                  <button className="icon-btn" title="Move down" disabled={i === qd.rows.length - 1} onClick={() => editQd((q) => { q.rows = moveItem(q.rows, i, i + 1) })}>↓</button>
                  <button className="icon-btn" title="Insert a line below" onClick={() => insertAt(i + 1, blank('line'))}>＋</button>
                  <button className="icon-btn danger" title="Delete row" onClick={() => editQd((q) => { q.rows.splice(i, 1); shiftBreaks(q, i + 1, -1) })}>✕</button>
                </div>
                {r.kind !== 'blank' && <RunsEditor path={`quote_doc.rows.${i}.runs`} runs={r.runs} onChange={(runs) => editQd((q) => { q.rows[i].runs = runs })} />}
              </div>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            {(['line', 'item', 'bullet', 'blank', 'section_head', 'highlight_line'] as RowKind[]).map((k) => (
              <button key={k} className="btn sm" onClick={() => insertAt(sel != null && sel < qd.rows.length ? sel + 1 : qd.rows.length, blank(k))}>+ {k.replace('_', ' ')}</button>
            ))}
          </div>
        </Card>
        <div className="quote-preview-col">
          <QuotePreview qd={qd} result={result} selected={sel} onSelect={(i) => { setSel(i >= 0 ? i : null); if (i >= 0) document.querySelector(`[data-row="quote_doc.rows.${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }} />
        </div>
      </div>
    </div>
  )
}

function AiDraft({ sel }: { sel: number | null }) {
  const { id, qd, editQd } = useEditor()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  async function go() {
    setBusy(true)
    setErr(null)
    try {
      const r = await runJob<{ draft: QuoteDraft }>(api.post<{ job_id: string }>(`/api/projects/${id}/ai/quote-text`))
      setDraft(r.draft)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const draftRows = (d: QuoteDraft): QuoteRow[] => d.rows.map((r) => ({ kind: r.kind, ...(r.item_no != null ? { item_no: r.item_no } : {}), runs: r.runs.map(normRun) }))
  return (
    <Card title="AI quotation text" actions={<button className="btn" onClick={() => void go()} disabled={busy} data-testid="ai-quote-text">{busy ? 'Drafting…' : 'Draft text with Claude'}</button>}>
      <p className="muted small">Claude drafts the item descriptions in Prolog house style from the BOM, drawing data and past quotations. Review everything — nothing is applied until you choose.</p>
      {busy && <Spinner label="Claude is drafting the quotation text…" />}
      <ErrorBox error={err} />
      {draft && (
        <div className="draft" data-testid="ai-draft">
          {draft.notes_for_engineer.length > 0 && <div className="alert warn"><strong>Notes for the engineer</strong><ul>{draft.notes_for_engineer.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
          <div className="btn-row">
            <button className="btn" onClick={() => { editQd((q) => { q.title.runs = [{ text: draft.title, bold: true, italic: false, underline: false, color: null }] }); toast.ok('Title replaced') }}>Apply title</button>
            <button className="btn primary" onClick={() => { if (window.confirm('Replace all body rows with the draft?')) { editQd((q) => { q.rows = draftRows(draft); if (Array.isArray(q.page_breaks)) q.page_breaks = 'auto' }); toast.ok('Body rows replaced') } }}>Replace body rows</button>
            <button className="btn" onClick={() => { editQd((q) => { const at = sel != null ? sel + 1 : q.rows.length; q.rows.splice(at, 0, ...draftRows(draft)) }); toast.ok('Draft rows inserted') }}>Insert {sel != null ? `after row ${sel + 1}` : 'at end'}</button>
            <button className="btn" onClick={() => setDraft(null)}>Dismiss</button>
          </div>
          <div className="diff">
            <div><h4>Current</h4><div className="diff-col">{qd.rows.map((r, i) => <div key={i} className={`dl ${r.kind}`}><RunsView runs={r.runs} />{r.kind === 'blank' && ' '}</div>)}</div></div>
            <div><h4>Draft <Badge tone="blue">{draft.rows.length} rows</Badge></h4>
              <div className="diff-col"><div className="dl title"><b>{draft.title}</b></div>
                {draft.rows.map((r, i) => <div key={i} className={`dl ${r.kind}`}>{r.kind === 'item' && <b>{r.item_no}. </b>}<RunsView runs={r.runs.map(normRun)} />{!rowText(r) && ' '}</div>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
