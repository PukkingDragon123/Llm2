import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Factory, Service } from '../api/types'
import { Calc } from '../components/fields'
import { DataTable } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Badge, Card, Sums } from '../components/ui'
import { useEditor } from '../editor'
import { uid } from '../lib/format'
import { R, moveItem } from '../lib/path'

export function ServicesTab() {
  const { est, edit, result } = useEditor()
  const [catalog, setCatalog] = useState<Service[]>([])
  useEffect(() => {
    api.get<Factory>('/api/settings/factory').then((f) => setCatalog(f.service_catalog || [])).catch(() => {})
  }, [])
  const cols: Col<Service>[] = [
    { key: 'group', label: 'Group', w: 110 },
    { key: 'name', label: 'Service', w: 220 },
    { key: 'amount', label: 'Fixed amount', kind: 'num', w: 110, disabled: (s) => s.rate != null && s.rate !== '', title: 'Fixed price per job. Ignored when a rate is entered.' },
    { key: 'rate', label: 'Rate', kind: 'num', w: 80, title: 'Unit rate; the amount becomes rate × qty (at least the minimum)' },
    { key: 'qty', label: 'Qty', kind: 'num', w: 70, disabled: (s) => s.rate == null || s.rate === '' },
    { key: 'minimum', label: 'Minimum', kind: 'num', w: 80, disabled: (s) => s.rate == null || s.rate === '' },
    { key: 'currency', label: 'Cur.', kind: 'sel', opts: [{ value: 'THB', label: 'THB' }, { value: 'USD', label: 'USD' }], w: 70 },
    { key: 'unit', label: 'Unit', w: 90 },
    { key: 'source', label: 'Source / basis', w: 200 },
    { key: 'mode', label: 'Mode', kind: 'node', noPath: true, node: (s) => (s.rate != null && s.rate !== '' ? <Badge tone="blue">rate × qty</Badge> : <Badge>fixed</Badge>) },
    { key: 'amt', label: 'Amount', kind: 'calc', calc: (s, i) => ({ k: `svc.${s.id || i}`, v: result.services[i]?.amount, strong: true }) },
    { key: 'thb', label: 'Amount THB', kind: 'calc', calc: (_s, i) => ({ v: result.services[i]?.amount_thb }) },
  ]
  const groups = [...new Set(est.services.map((s) => s.group).filter(Boolean))]
  return (
    <div className="stack">
      <Card
        title={`Outsource / NDT / finishing / packing services (${est.services.length})`}
        flush
        actions={
          <>
            <select className="inp" value="" onChange={(e) => { const c = catalog[Number(e.target.value)]; if (c) edit((x) => { x.services.push({ ...structuredClone(c), id: uid('s') }) }) }} aria-label="Add from catalog">
              <option value="">+ Add from catalog…</option>
              {catalog.map((c, i) => <option key={i} value={i}>{c.group} · {c.name}</option>)}
            </select>
          </>
        }
      >
        <datalist id="svc-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <DataTable
          path="services"
          rows={est.services}
          cols={cols}
          onCell={(i, k, v) => edit((e) => { R(e.services[i])[k] = v })}
          onAdd={() => edit((e) => { e.services.push({ id: uid('s'), group: '', name: '', amount: null, currency: 'THB', unit: 'Cost /Job', source: '' }) })}
          addLabel="Add service"
          onDelete={(i) => edit((e) => { e.services.splice(i, 1) })}
          onDuplicate={(i) => edit((e) => { const c = structuredClone(e.services[i]); c.id = uid('s'); e.services.splice(i + 1, 0, c) })}
          onMove={(i, d) => edit((e) => { e.services = moveItem(e.services, i, i + d) })}
          toolbar={<Sums items={[{ label: 'Total services (THB)', value: <Calc k="svc.total" v={result.summary_thb.services} strong />, grand: true }]} />}
        />
      </Card>
      <p className="muted small">Enter a fixed amount per job, or a unit rate with quantity (and optional minimum charge). Amounts may be arithmetic expressions such as <code>45000+42000</code>. Services priced in USD are converted to THB with the conversion rate TU.</p>
    </div>
  )
}
