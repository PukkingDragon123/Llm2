import { useState } from 'react'
import type { PriceLine, PriceSheet, SupplierPrice } from '../api/types'
import { Calc, NumIn, SelIn, TextIn } from '../components/fields'
import { DataTable } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { PricePicker } from '../components/PricePicker'
import { Badge, Card, Field, Sums } from '../components/ui'
import { useEditor } from '../editor'
import { slug } from '../lib/format'
import { moveItem } from '../lib/path'

export function PricesTab() {
  const { est, edit } = useEditor()
  const [picker, setPicker] = useState<{ si: number; li: number } | null>(null)

  function pick(p: SupplierPrice) {
    if (!picker) return
    const { si, li } = picker
    edit((e) => {
      const ln = e.price_sheets[si].lines[li]
      ln.unit_price = p.unit_price
      ln.price_source = `${p.supplier_name} ${p.quote_date} ${p.source}`.trim()
      ln.supplier_price_id = p.id
    })
    setPicker(null)
  }
  function addSheet() {
    const name = window.prompt('Name of the new price sheet (e.g. "Domestic Price")')
    if (!name) return
    let id = slug(name)
    while (est.price_sheets.some((s) => s.id === id)) id += '_2'
    edit((e) => {
      e.price_sheets.push({ id, name, currency: 'USD', round_digits: -1, tax_pct: 0, margin_divisor: 1, freight: [], lines: [] })
    })
  }
  const picked = picker ? est.price_sheets[picker.si]?.lines[picker.li] : null
  return (
    <div className="stack">
      <div className="muted">Supplier price sheets: material cost + allocated freight → selling price per piece (rounded) → quote item cost base. Unit prices must come from a verified supplier quotation — blank prices are reported as missing.</div>
      {est.price_sheets.map((_, si) => (
        <SheetCard key={si} si={si} onPick={(li) => setPicker({ si, li })} />
      ))}
      <div><button className="btn" onClick={addSheet}>+ Add price sheet</button></div>
      {picker && picked && (
        <PricePicker initial={picked.description || ''} currency={est.price_sheets[picker.si].currency} onPick={pick} onClose={() => setPicker(null)} />
      )}
    </div>
  )
}

function SheetCard({ si, onPick }: { si: number; onPick: (li: number) => void }) {
  const { est, edit, result } = useEditor()
  const sh: PriceSheet = est.price_sheets[si]
  const rs = result.price_sheets[si]
  const sid = rs?.id ?? sh.id
  const cur = sh.currency
  const setSheet = (k: string, v: unknown) => edit((e) => { (e.price_sheets[si] as unknown as Record<string, unknown>)[k] = v })

  const cols: Col<PriceLine>[] = [
    { key: 'group', label: 'Group', w: 96 },
    { key: 'material', label: 'Material', w: 84 },
    { key: 'description', label: 'Description / size', w: 190 },
    { key: 'qty', label: 'Qty', kind: 'num', w: 60 },
    { key: 'unit_price', label: `Supplier unit price (${cur})`, kind: 'num', w: 110 },
    { key: 'unit_weight', label: 'Unit wt kg', kind: 'num', w: 80 },
    { key: 'cost', label: 'Cost', kind: 'calc', calc: (_l, li) => ({ v: rs?.lines[li]?.cost }) },
    { key: 'alloc', label: 'Allocated', kind: 'calc', calc: (_l, li) => ({ v: rs?.lines[li]?.allocated }) },
    { key: 'R', label: 'Selling unit', kind: 'calc', calc: (_l, li) => ({ k: `ps.${sid}.l${li}.R`, v: rs?.lines[li]?.selling_unit }) },
    { key: 'S', label: `Amount (${cur})`, kind: 'calc', calc: (_l, li) => ({ k: `ps.${sid}.l${li}.S`, v: rs?.lines[li]?.amount, strong: true }) },
    {
      key: 'price_source', label: 'Price source', w: 160,
      kind: 'node', noPath: true,
      node: (l, li) => (
        <span className="src-cell">
          <TextIn path={`price_sheets.${si}.lines.${li}.price_source`} value={l.price_source} onChange={(v) => edit((e) => { e.price_sheets[si].lines[li].price_source = v })} />
          {l.supplier_price_id ? <Badge tone="green" title="Linked to the verified supplier price list">#{l.supplier_price_id}</Badge> : null}
        </span>
      ),
    },
    { key: 'pick', label: '', kind: 'node', noPath: true, node: (_l, li) => <button className="btn sm" onClick={() => onPick(li)} data-testid="pick-price" title="Pick a verified supplier price">Pick price…</button> },
  ]

  return (
    <Card
      dataRow={`price_sheets.${si}`}
      title={<>{sh.name} <Badge>{cur}</Badge></>}
      actions={
        <>
          <span className="muted small">Total </span>
          <Calc k={`ps.${sid}.total`} v={rs?.total} strong unit={cur} />
          <button className="btn sm danger" style={{ marginLeft: 12 }} onClick={() => { if (window.confirm(`Delete price sheet "${sh.name}" and its ${sh.lines.length} lines?`)) edit((e) => { e.price_sheets.splice(si, 1) }) }}>Delete sheet</button>
        </>
      }
      flush
    >
      <div className="sheet-params">
        <Field label="Sheet name"><TextIn path={`price_sheets.${si}.name`} value={sh.name} onChange={(v) => setSheet('name', v)} /></Field>
        <Field label="Currency"><SelIn path={`price_sheets.${si}.currency`} value={sh.currency} options={[{ value: 'USD', label: 'USD' }, { value: 'THB', label: 'THB' }]} onChange={(v) => setSheet('currency', v)} /></Field>
        <Field label="Round digits" hint="-1 = tens, 0 = units"><NumIn path={`price_sheets.${si}.round_digits`} value={sh.round_digits} onChange={(v) => setSheet('round_digits', v ?? 0)} /></Field>
        <Field label="Tax (fraction)"><NumIn path={`price_sheets.${si}.tax_pct`} pct value={sh.tax_pct} onChange={(v) => setSheet('tax_pct', v)} /></Field>
        <Field label="Margin divisor"><NumIn path={`price_sheets.${si}.margin_divisor`} value={sh.margin_divisor} onChange={(v) => setSheet('margin_divisor', v)} /></Field>
        <Field label="Line exchange factor"><NumIn path={`price_sheets.${si}.exchange`} value={sh.exchange} placeholder="1" onChange={(v) => setSheet('exchange', v)} /></Field>
      </div>

      <DataTable
        path={`price_sheets.${si}.lines`}
        rows={sh.lines}
        cols={cols}
        onCell={(li, k, v) => edit((e) => { (e.price_sheets[si].lines[li] as unknown as Record<string, unknown>)[k] = v })}
        onAdd={() => edit((e) => { e.price_sheets[si].lines.push({ id: `r${Date.now().toString(36).slice(-4)}`, group: '', material: '', description: '', qty: null, unit_price: null, unit_weight: null, price_source: '', supplier_price_id: null }) })}
        addLabel="Add line"
        onDelete={(li) => edit((e) => { e.price_sheets[si].lines.splice(li, 1) })}
        onDuplicate={(li) => edit((e) => { const c = structuredClone(e.price_sheets[si].lines[li]); c.supplier_price_id = null; e.price_sheets[si].lines.splice(li + 1, 0, c) })}
        onMove={(li, d) => edit((e) => { e.price_sheets[si].lines = moveItem(e.price_sheets[si].lines, li, li + d) })}
        toolbar={
          <Sums items={[
            { label: 'Material cost (÷ margin divisor)', value: <Calc k={`ps.${sid}.N`} v={rs?.material_cost} /> },
            { label: `Freight (${cur})`, value: <Calc v={rs?.freight_total} /> },
            { label: 'Material + freight', value: <Calc k={`ps.${sid}.grand`} v={rs?.grand} /> },
            { label: 'Sheet total', value: <Calc k={`ps.${sid}.total`} v={rs?.total} strong unit={cur} />, grand: true },
          ]} />
        }
      />

      <div className="freight">
        <h4>Freight / extra costs allocated over the lines</h4>
        <DataTable
          path={`price_sheets.${si}.freight`}
          rows={sh.freight}
          numbered={false}
          cols={[
            { key: 'label', label: 'Label', w: 260 },
            { key: 'amount', label: 'Amount', kind: 'num', w: 120 },
            { key: 'currency', label: 'Currency', kind: 'sel', opts: [{ value: 'THB', label: 'THB' }, { value: 'USD', label: 'USD' }], w: 90 },
            { key: 'conv', label: `In ${cur}`, kind: 'calc', calc: (_f, fi) => ({ k: `ps.${sid}.f${fi}`, v: result.nodes[`ps.${sid}.f${fi}`]?.value }) },
          ] as Col<(typeof sh.freight)[number]>[]}
          onCell={(fi, k, v) => edit((e) => { (e.price_sheets[si].freight[fi] as unknown as Record<string, unknown>)[k] = v })}
          onAdd={() => edit((e) => { e.price_sheets[si].freight.push({ label: '', amount: null, currency: e.price_sheets[si].currency }) })}
          addLabel="Add freight line"
          onDelete={(fi) => edit((e) => { e.price_sheets[si].freight.splice(fi, 1) })}
          empty="No freight lines"
        />
      </div>
    </Card>
  )
}
