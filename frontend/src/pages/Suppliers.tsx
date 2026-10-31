import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Factory, Supplier, SupplierPrice } from '../api/types'
import { AgeBadge } from '../components/PricePicker'
import { Badge, Card, ErrorBox, Field, Modal, Spinner, Tabs, useToast } from '../components/ui'
import { fmt } from '../lib/format'

type PriceForm = Omit<SupplierPrice, 'id' | 'age_days'> & { id?: number }
const blankPrice = (): PriceForm => ({ supplier_id: null, supplier_name: '', category: '', material: '', description: '', thk: null, width: null, length: null, od: null, unit: 'pc', unit_price: 0, currency: 'USD', unit_weight: null, quote_date: new Date().toISOString().slice(0, 10), valid_until: '', source: '', verified: false })
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

export function Suppliers() {
  const toast = useToast()
  const [tab, setTab] = useState<'prices' | 'suppliers'>('prices')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [prices, setPrices] = useState<SupplierPrice[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [q, setQ] = useState('')
  const [material, setMaterial] = useState('')
  const [category, setCategory] = useState('')
  const [supplier, setSupplier] = useState('')
  const [stale, setStale] = useState(false)
  const [maxAge, setMaxAge] = useState(90)
  const [edit, setEdit] = useState<PriceForm | null>(null)
  const [supEdit, setSupEdit] = useState<Partial<Supplier> | null>(null)

  const loadSup = useCallback(() => { api.get<Supplier[]>('/api/suppliers').then(setSuppliers).catch(setErr) }, [])
  const loadPrices = useCallback(() => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (material) p.set('material', material)
    if (category) p.set('category', category)
    api.get<SupplierPrice[]>(`/api/prices?${p}`).then(setPrices).catch(setErr)
  }, [q, material, category])
  useEffect(loadSup, [loadSup])
  useEffect(() => {
    const t = setTimeout(loadPrices, 200)
    return () => clearTimeout(t)
  }, [loadPrices])
  useEffect(() => { api.get<Factory>('/api/settings/factory').then((f) => setMaxAge(f.price_max_age_days || 90)).catch(() => {}) }, [])

  const shown = (prices || []).filter((p) => (!supplier || String(p.supplier_id) === supplier) && (!stale || (p.age_days ?? 0) > maxAge))

  async function savePrice() {
    if (!edit) return
    try {
      const body = { ...edit, unit_price: Number(edit.unit_price), valid_until: edit.valid_until || '' }
      if (edit.id) await api.put(`/api/prices/${edit.id}`, body)
      else await api.post('/api/prices', body)
      toast.ok('Price saved')
      setEdit(null)
      loadPrices()
      loadSup()
    } catch (e) { toast.err(e) }
  }
  async function delPrice(p: SupplierPrice) {
    if (!window.confirm(`Delete price "${p.description}" from ${p.supplier_name}?`)) return
    try { await api.del(`/api/prices/${p.id}`); loadPrices(); loadSup() } catch (e) { toast.err(e) }
  }
  async function saveSupplier() {
    if (!supEdit?.name) return
    try {
      const body = { name: supEdit.name, country: supEdit.country || '', contact: supEdit.contact || '', lead_time: supEdit.lead_time || '', notes: supEdit.notes || '' }
      if (supEdit.id) await api.put(`/api/suppliers/${supEdit.id}`, body)
      else await api.post('/api/suppliers', body)
      toast.ok('Supplier saved')
      setSupEdit(null)
      loadSup()
    } catch (e) { toast.err(e) }
  }

  const cats = [...new Set((prices || []).map((p) => p.category).filter(Boolean))]
  const setE = <K extends keyof PriceForm>(k: K, v: PriceForm[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e))
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Suppliers &amp; prices</h1><p className="muted">Verified supplier quotations used for the material price sheets. Prices older than {maxAge} days are flagged.</p></div>
        <div className="btn-row">
          <button className="btn" onClick={() => setSupEdit({ name: '' })} data-testid="add-supplier">+ Supplier</button>
          <button className="btn primary" onClick={() => setEdit(blankPrice())} data-testid="add-price">+ Add price</button>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'prices', label: <>Price list {prices && <Badge>{prices.length}</Badge>}</> }, { id: 'suppliers', label: <>Suppliers <Badge>{suppliers.length}</Badge></> }]} />
      <ErrorBox error={err} />
      {tab === 'prices' && (
        <>
          <div className="filters">
            <input className="inp search" placeholder="Search description, material, supplier…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search prices" data-testid="price-q" />
            <input className="inp" placeholder="Material (e.g. Ti.Gr.2)" value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Material filter" />
            <input className="inp" list="price-cats" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter" /><datalist id="price-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            <select className="inp" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier filter"><option value="">All suppliers</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <label className="chk"><input type="checkbox" checked={stale} onChange={(e) => setStale(e.target.checked)} /> only older than {maxAge} d</label>
          </div>
          {!prices && <Spinner />}
          {prices && (
            <div className="card"><div className="card-body flush"><div className="dt-scroll" style={{ maxHeight: 'calc(100vh - 290px)' }}>
              <table className="dt compact" data-testid="prices-table">
                <thead><tr><th>Supplier</th><th>Category</th><th>Material</th><th>Description</th><th className="r">Unit price</th><th>Cur.</th><th>Unit</th><th className="r">Unit wt kg</th><th>Quote date</th><th>Age</th><th>Valid until</th><th>Verified</th><th>Source</th><th /></tr></thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id}>
                      <td>{p.supplier_name}</td><td>{p.category}</td><td>{p.material}</td><td>{p.description}</td>
                      <td className="r num">{fmt(p.unit_price)}</td><td>{p.currency}</td><td>{p.unit}</td><td className="r num">{p.unit_weight != null ? fmt(p.unit_weight) : ''}</td>
                      <td>{p.quote_date}</td><td><AgeBadge days={p.age_days} max={maxAge} /></td><td>{p.valid_until}</td>
                      <td>{p.verified ? <Badge tone="green">verified</Badge> : <Badge>unverified</Badge>}</td><td className="muted small">{p.source}</td>
                      <td className="act"><span className="row-actions"><button className="icon-btn" title="Edit" onClick={() => setEdit({ ...p })}>✎</button><button className="icon-btn danger" title="Delete" onClick={() => void delPrice(p)}>✕</button></span></td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={14} className="empty-cell">No prices match the filters.</td></tr>}
                </tbody>
              </table>
            </div></div></div>
          )}
        </>
      )}
      {tab === 'suppliers' && (
        <Card flush>
          <table className="dt" data-testid="suppliers-table">
            <thead><tr><th>Name</th><th>Country</th><th>Contact</th><th>Lead time</th><th>Notes</th><th className="r">Prices</th><th /></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.country}</td><td>{s.contact}</td><td>{s.lead_time}</td><td>{s.notes}</td><td className="r">{s.price_count}</td><td className="act"><button className="icon-btn" title="Edit" onClick={() => setSupEdit({ ...s })}>✎</button></td></tr>
              ))}
              {suppliers.length === 0 && <tr><td colSpan={7} className="empty-cell">No suppliers</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {edit && (
        <Modal title={edit.id ? 'Edit price' : 'Add supplier price'} size="lg" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => void savePrice()} disabled={!edit.description && !edit.material} data-testid="save-price">Save price</button></>}>
          <div className="form-grid cols3">
            <Field label="Supplier"><select className="inp" value={edit.supplier_id ?? ''} onChange={(e) => { const s = suppliers.find((x) => x.id === Number(e.target.value)); setEdit({ ...edit, supplier_id: s?.id ?? null, supplier_name: s?.name ?? edit.supplier_name }) }}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Category"><input className="inp" value={edit.category} onChange={(e) => setE('category', e.target.value)} placeholder="Plate, Pipe, Flange…" /></Field>
            <Field label="Material"><input className="inp" value={edit.material} onChange={(e) => setE('material', e.target.value)} placeholder="Ti.Gr.2" /></Field>
            <Field label="Description / size" wide><input className="inp" value={edit.description} onChange={(e) => setE('description', e.target.value)} placeholder="1000x1500x3t mm." /></Field>
            <Field label="Unit"><input className="inp" value={edit.unit} onChange={(e) => setE('unit', e.target.value)} /></Field>
            <Field label="Thickness mm"><input className="inp num" value={edit.thk ?? ''} onChange={(e) => setE('thk', numOrNull(e.target.value))} /></Field>
            <Field label="Width mm"><input className="inp num" value={edit.width ?? ''} onChange={(e) => setE('width', numOrNull(e.target.value))} /></Field>
            <Field label="Length mm"><input className="inp num" value={edit.length ?? ''} onChange={(e) => setE('length', numOrNull(e.target.value))} /></Field>
            <Field label="OD mm"><input className="inp num" value={edit.od ?? ''} onChange={(e) => setE('od', numOrNull(e.target.value))} /></Field>
            <Field label="Unit price *"><input className="inp num" type="number" step="any" value={edit.unit_price} onChange={(e) => setE('unit_price', Number(e.target.value))} data-testid="price-unit-price" /></Field>
            <Field label="Currency"><select className="inp" value={edit.currency} onChange={(e) => setE('currency', e.target.value)}><option>USD</option><option>THB</option></select></Field>
            <Field label="Unit weight kg"><input className="inp num" value={edit.unit_weight ?? ''} onChange={(e) => setE('unit_weight', numOrNull(e.target.value))} /></Field>
            <Field label="Quote date"><input className="inp" type="date" value={edit.quote_date || ''} onChange={(e) => setE('quote_date', e.target.value)} /></Field>
            <Field label="Valid until"><input className="inp" type="date" value={edit.valid_until || ''} onChange={(e) => setE('valid_until', e.target.value)} /></Field>
            <Field label="Source (quotation ref.)" wide><input className="inp" value={edit.source} onChange={(e) => setE('source', e.target.value)} /></Field>
            <Field label="Verified"><label className="chk"><input type="checkbox" checked={edit.verified} onChange={(e) => setE('verified', e.target.checked)} /> checked by purchasing</label></Field>
          </div>
        </Modal>
      )}
      {supEdit && (
        <Modal title={supEdit.id ? 'Edit supplier' : 'Add supplier'} onClose={() => setSupEdit(null)} footer={<><button className="btn" onClick={() => setSupEdit(null)}>Cancel</button><button className="btn primary" onClick={() => void saveSupplier()} disabled={!supEdit.name}>Save supplier</button></>}>
          <div className="form-grid">
            <Field label="Name" wide><input className="inp" value={supEdit.name || ''} onChange={(e) => setSupEdit({ ...supEdit, name: e.target.value })} autoFocus /></Field>
            <Field label="Country"><input className="inp" value={supEdit.country || ''} onChange={(e) => setSupEdit({ ...supEdit, country: e.target.value })} /></Field>
            <Field label="Lead time"><input className="inp" value={supEdit.lead_time || ''} onChange={(e) => setSupEdit({ ...supEdit, lead_time: e.target.value })} /></Field>
            <Field label="Contact" wide><input className="inp" value={supEdit.contact || ''} onChange={(e) => setSupEdit({ ...supEdit, contact: e.target.value })} /></Field>
            <Field label="Notes" wide><textarea className="inp" rows={2} value={supEdit.notes || ''} onChange={(e) => setSupEdit({ ...supEdit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
