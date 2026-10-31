import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SupplierPrice } from '../api/types'
import { fmt } from '../lib/format'
import { Badge, ErrorBox, Modal, Spinner } from './ui'

export function AgeBadge({ days, max = 90 }: { days: number | null; max?: number }) {
  if (days == null) return <Badge>—</Badge>
  return <Badge tone={days > max ? 'amber' : 'green'} title={days > max ? `Older than ${max} days — re-confirm` : 'Recent'}>{days} d</Badge>
}

/** Search the verified supplier price list and pick one for a price-sheet line. */
export function PricePicker({ initial, currency, onPick, onClose }: { initial: string; currency: string; onPick: (p: SupplierPrice) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial)
  const [rows, setRows] = useState<SupplierPrice[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setRows(null)
      api.get<SupplierPrice[]>(`/api/prices?q=${encodeURIComponent(q)}`).then(setRows).catch(setErr)
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <Modal title="Pick a verified supplier price" size="xl" onClose={onClose}>
      <input className="inp search" autoFocus placeholder="Search description, material, category, supplier…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="price-search" />
      <ErrorBox error={err} />
      {!rows && !err && <Spinner label="Searching…" />}
      {rows && (
        <div className="dt-scroll" style={{ maxHeight: '50vh', marginTop: 10 }}>
          <table className="dt compact" data-testid="price-results">
            <thead><tr><th>Supplier</th><th>Category</th><th>Material</th><th>Description</th><th className="r">Unit price</th><th>Age</th><th>Verified</th><th>Source</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.supplier_name}</td><td>{p.category}</td><td>{p.material}</td><td>{p.description}</td>
                  <td className="r num">{fmt(p.unit_price)} {p.currency}{p.currency !== currency && <Badge tone="red" title={`Sheet currency is ${currency}`}>≠{currency}</Badge>}</td>
                  <td><AgeBadge days={p.age_days} /></td>
                  <td>{p.verified ? <Badge tone="green">yes</Badge> : <Badge>no</Badge>}</td>
                  <td className="muted small">{p.source}</td>
                  <td><button className="btn sm primary" onClick={() => onPick(p)}>Use</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="empty-cell">No matching prices. Add them under Suppliers & prices.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
