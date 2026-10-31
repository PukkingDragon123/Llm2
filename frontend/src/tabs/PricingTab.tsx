import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Adjustment, Bucket, BucketSource, LearningSuggestion, Calibration } from '../api/types'
import { Calc, ChkIn, NumIn, SelIn, TextIn } from '../components/fields'
import { DataTable } from '../components/DataTable'
import { Badge, Card, ErrorBox, Field, Spinner, useToast } from '../components/ui'
import { useEditor } from '../editor'
import { fmtPct } from '../lib/format'
import { R, moveItem } from '../lib/path'

const SRC_TYPES = [
  { value: 'price_sheet', label: 'Price sheet' },
  { value: 'services', label: 'All services' },
  { value: 'crews', label: 'All crews (labor)' },
  { value: 'machines', label: 'Machine processes' },
  { value: 'parts_material', label: 'BOM parts material (by weight)' },
  { value: 'fixed', label: 'Fixed amount' },
]

export function PricingTab() {
  const { est, edit, result } = useEditor()
  const s = est.settings
  const set = (k: string, v: unknown) => edit((e) => { R(e.settings)[k] = v })
  const num = (k: string, label: string, hint?: string, pct?: boolean) => (
    <Field label={label} hint={hint}><NumIn path={`settings.${k}`} pct={pct} value={s[k] as never} onChange={(v) => set(k, v)} /></Field>
  )
  return (
    <div className="stack">
      <Card title="Pricing settings">
        <div className="form-grid cols4">
          <Field label="Quote currency"><SelIn path="settings.quote_currency" value={s.quote_currency} options={[{ value: 'USD', label: 'USD' }, { value: 'THB', label: 'THB' }]} onChange={(v) => set('quote_currency', v)} /></Field>
          {num('fx_thb_per_usd', 'FX: THB per USD')}
          <Field label="FX date"><TextIn path="settings.fx_date" value={s.fx_date as string} onChange={(v) => set('fx_date', v)} /></Field>
          {num('thb_to_usd_factor', 'THB→USD factor', 'TU = factor × FX; THB ÷ TU = USD')}
          {num('usd_to_thb_factor', 'USD→THB factor', 'UT = factor × FX; USD × UT = THB')}
          {num('ovh_pct', 'Overhead (fraction)', undefined, true)}
          {num('risk_pct', 'Risk (fraction)', undefined, true)}
          {num('margin_divisor', 'Margin divisor', 'price = cost × (1+OVH+Risk) ÷ divisor')}
          {num('item_round_digits', 'Item round digits', '-1 = round up to tens')}
          {num('ces_round_digits', 'CES round digits', '-2 = hundreds')}
          {num('ces_discount_pct', 'CES discount (fraction)', undefined, true)}
          {num('quote_discount_pct', 'Quotation discount (fraction)', undefined, true)}
          {num('set_qty', 'Set quantity')}
          <Field label="Header price mode" hint="ces = CES net price · sum_items = total price · manual">
            <SelIn path="settings.header_price_mode" value={s.header_price_mode} options={[{ value: 'ces', label: 'ces (CES net)' }, { value: 'sum_items', label: 'sum_items' }, { value: 'manual', label: 'manual' }]} onChange={(v) => set('header_price_mode', v)} />
          </Field>
          {num('header_price_manual', 'Header price (manual mode)')}
        </div>
        <p className="muted small">TU = <Calc k="set.TU" v={result.TU} dp={4} /> THB/USD · UT = <Calc k="set.UT" v={result.UT} dp={4} /> THB/USD</p>
      </Card>

      <div className="section-head"><h2>Quote items</h2>
        <button className="btn sm" onClick={() => edit((e) => { const no = Math.max(0, ...e.buckets.map((b) => Number(b.no) || 0)) + 1; e.buckets.push({ no, heading: '', unit: 'Lot.', qty: 1, markup: true, sources: [], adjustments: [] }) })}>+ Add quote item</button>
      </div>
      {est.buckets.map((b, bi) => <BucketCard key={bi} bi={bi} b={b} />)}
      <LearningPanel />
    </div>
  )
}

function BucketCard({ bi, b }: { bi: number; b: Bucket }) {
  const { est, edit, result } = useEditor()
  const it = result.items.find((x) => x.no === b.no)
  const set = (k: string, v: unknown) => edit((e) => { R(e.buckets[bi])[k] = v })
  const sheetOpts = est.price_sheets.map((s) => ({ value: s.id, label: s.name }))
  const adjs = b.adjustments || []
  return (
    <Card
      dataRow={`buckets.${bi}`}
      title={<>Item {b.no}: {b.heading || <em>untitled</em>}</>}
      actions={
        <>
          <span className="muted small">Cost base </span><Calc k={`item.${b.no}.base`} v={it?.base} />
          <span className="muted small" style={{ marginLeft: 10 }}>Unit price </span><Calc k={`item.${b.no}.price`} v={it?.unit_price} strong />
          <span className="muted small" style={{ marginLeft: 10 }}>Total </span><Calc k={`item.${b.no}.total`} v={it?.total} strong />
          <span className="muted small" style={{ marginLeft: 10 }}>Margin </span><Calc v={it?.margin} pct />
          <button className="icon-btn" title="Move up" onClick={() => edit((e) => { e.buckets = moveItem(e.buckets, bi, bi - 1) })}>↑</button>
          <button className="icon-btn" title="Move down" onClick={() => edit((e) => { e.buckets = moveItem(e.buckets, bi, bi + 1) })}>↓</button>
          <button className="icon-btn danger" title="Delete item" onClick={() => { if (window.confirm(`Delete quote item ${b.no}?`)) edit((e) => { e.buckets.splice(bi, 1) }) }}>✕</button>
        </>
      }
    >
      <div className="form-grid cols4">
        <Field label="Item no."><NumIn path={`buckets.${bi}.no`} value={b.no} onChange={(v) => set('no', v ?? 0)} /></Field>
        <Field label="Heading" wide><TextIn path={`buckets.${bi}.heading`} value={b.heading} onChange={(v) => set('heading', v)} /></Field>
        <Field label="Unit"><TextIn path={`buckets.${bi}.unit`} value={b.unit} onChange={(v) => set('unit', v)} /></Field>
        <Field label="Quantity"><NumIn path={`buckets.${bi}.qty`} value={b.qty} onChange={(v) => set('qty', v)} /></Field>
        <Field label="Markup"><ChkIn path={`buckets.${bi}.markup`} value={b.markup} label="apply OVH + Risk + margin" onChange={(v) => set('markup', v)} /></Field>
        <Field label="Manual price override" hint="blank = use calculated price"><NumIn path={`buckets.${bi}.override_price`} value={b.override_price} onChange={(v) => set('override_price', v)} /></Field>
        <Field label="Override reason" wide><TextIn path={`buckets.${bi}.override_reason`} value={b.override_reason} onChange={(v) => set('override_reason', v)} placeholder="required when overriding" /></Field>
      </div>

      <h4>Cost sources</h4>
      <DataTable
        path={`buckets.${bi}.sources`}
        rows={b.sources}
        numbered={false}
        cols={[
          { key: 'type', label: 'Source', kind: 'sel', opts: SRC_TYPES, w: 210 },
          { key: 'detail', label: 'Detail', kind: 'node', noPath: true, w: 260, node: (s: BucketSource, si) =>
            s.type === 'price_sheet' ? <SelIn path={`buckets.${bi}.sources.${si}.id`} value={s.id} options={sheetOpts} onChange={(v) => edit((e) => { e.buckets[bi].sources[si].id = v })} />
            : s.type === 'fixed' ? <TextIn path={`buckets.${bi}.sources.${si}.label`} value={s.label} placeholder="label" onChange={(v) => edit((e) => { e.buckets[bi].sources[si].label = v })} />
            : <span className="muted small">uses the total of the project’s {s.type === 'parts_material' ? 'parts material' : s.type}</span> },
          { key: 'amount', label: 'Amount (fixed)', kind: 'num', w: 110, disabled: (s: BucketSource) => s.type !== 'fixed' },
          { key: 'currency', label: 'Currency', kind: 'sel', opts: [{ value: 'USD', label: 'USD' }, { value: 'THB', label: 'THB' }], w: 80, disabled: (s: BucketSource) => s.type !== 'fixed' },
        ]}
        onCell={(si, k, v) => edit((e) => { R(e.buckets[bi].sources[si])[k] = v; if (k === 'type') { const src = e.buckets[bi].sources[si]; if (v === 'price_sheet') src.id = e.price_sheets[0]?.id; else delete src.id; if (v === 'fixed') src.currency = e.settings.quote_currency } })}
        onAdd={() => edit((e) => { e.buckets[bi].sources.push({ type: 'price_sheet', id: e.price_sheets[0]?.id }) })}
        addLabel="Add source"
        onDelete={(si) => edit((e) => { e.buckets[bi].sources.splice(si, 1) })}
        empty="No sources — this item would have zero cost."
      />

      <h4>Adjustments (applied multiplicatively to the cost base; always with a reason)</h4>
      <DataTable
        path={`buckets.${bi}.adjustments`}
        rows={adjs}
        numbered={false}
        cols={[
          { key: 'label', label: 'Label', w: 200 },
          { key: 'pct', label: '% (fraction, e.g. 0.05)', kind: 'num', pct: true, w: 120 },
          { key: 'reason', label: 'Reason / evidence', w: 360 },
          { key: 'source', label: 'Source', w: 110 },
        ]}
        onCell={(ai, k, v) => edit((e) => { R(e.buckets[bi].adjustments![ai])[k] = v })}
        onAdd={() => edit((e) => { (e.buckets[bi].adjustments ||= []).push({ label: '', pct: null, reason: '', source: 'engineer' }) })}
        addLabel="Add adjustment"
        onDelete={(ai) => edit((e) => { e.buckets[bi].adjustments!.splice(ai, 1) })}
        empty="No adjustments"
      />
    </Card>
  )
}

function LearningPanel() {
  const { id, edit, est } = useEditor()
  const toast = useToast()
  const [data, setData] = useState<{ calibration: Calibration; suggestions: LearningSuggestion[] } | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const load = useCallback(() => {
    setData(null)
    api.get<{ calibration: Calibration; suggestions: LearningSuggestion[] }>(`/api/projects/${id}/learning`).then(setData).catch(setErr)
  }, [id])
  useEffect(load, [load])
  function apply(s: LearningSuggestion) {
    edit((e) => {
      const b = e.buckets.find((x) => x.no === s.item)
      if (!b) return
      const adj: Adjustment = { label: `Historical calibration: ${s.category}`, pct: Number(s.suggested_pct.toFixed(4)), reason: s.evidence.join('; ') || `${s.n} completed project(s)`, source: 'history' }
      ;(b.adjustments ||= []).push(adj)
    })
    toast.ok(`Adjustment added to item ${s.item} — review it before saving`)
  }
  return (
    <Card title="Historical calibration suggestions" actions={<button className="btn sm" onClick={load}>Refresh</button>}>
      <p className="muted small">Calibration factors learned from completed projects with recorded actual costs. Suggestions are never applied automatically — add one as an adjustment only if the evidence is relevant to this job.</p>
      <ErrorBox error={err} />
      {!data && !err && <Spinner label="Loading…" />}
      {data && data.suggestions.length === 0 && <p className="muted">No calibration data yet. Record actual costs in the Actuals tab of completed projects to build history.</p>}
      {data && data.suggestions.length > 0 && (
        <table className="dt compact" data-testid="learning-suggestions">
          <thead><tr><th>Item</th><th>Category</th><th className="r">Suggested adj.</th><th className="r">n</th><th>Reliable</th><th>Evidence</th><th /></tr></thead>
          <tbody>
            {data.suggestions.map((s, i) => {
              const applied = est.buckets.find((b) => b.no === s.item)?.adjustments?.some((a) => a.label === `Historical calibration: ${s.category}`)
              return (
                <tr key={i}>
                  <td>{s.item}. {s.heading}</td><td>{s.label}</td>
                  <td className="r num">{fmtPct(s.suggested_pct, 1)}</td><td className="r">{s.n}</td>
                  <td>{s.reliable ? <Badge tone="green">reliable</Badge> : <Badge tone="amber" title="needs ≥3 projects with consistent ratios">low evidence</Badge>}</td>
                  <td className="small">{s.evidence.join('; ')}</td>
                  <td><button className="btn sm" disabled={applied} onClick={() => apply(s)}>{applied ? 'Applied' : 'Apply as adjustment'}</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}
