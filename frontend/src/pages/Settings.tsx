import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { AiStatus, Crew, Factory, Material, Service } from '../api/types'
import { NumIn, SelIn, TextIn } from '../components/fields'
import { DataTable } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Badge, Card, ErrorBox, Field, Spinner, Tabs, useToast } from '../components/ui'
import { R, moveItem } from '../lib/path'

export function Settings() {
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p className="muted">Claude API access and the factory defaults used for every new project.</p></div></div>
      <AiSettings />
      <FactorySettings />
    </div>
  )
}

function AiSettings() {
  const toast = useToast()
  const [st, setSt] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<AiStatus>('/api/settings/ai').then((s) => { setSt(s); setModel(s.model) }).catch(setErr) }, [])
  async function save(body: { api_key?: string; model?: string }) {
    setBusy(true)
    setErr(null)
    try {
      const s = await api.put<AiStatus>('/api/settings/ai', body)
      setSt(s); setModel(s.model); setKey('')
      toast.ok(s.configured ? 'Claude API settings saved' : 'API key removed')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return (
    <Card title="Claude API" actions={st && (st.configured ? <Badge tone="green">configured ({st.source})</Badge> : <Badge tone="amber">not configured</Badge>)}>
      <p className="muted small">Used for drawing analysis, estimating suggestions, quotation text and question consolidation. The key is stored on the server and is never shown again.</p>
      {!st && !err && <Spinner />}
      <ErrorBox error={err} />
      <div className="form-grid cols3">
        <Field label="Anthropic API key" hint={st?.configured ? 'A key is set. Enter a new one to replace it.' : 'sk-ant-…'}><input className="inp" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={st?.configured ? '••••••••••••' : 'sk-ant-api…'} data-testid="api-key" /></Field>
        <Field label="Model"><input className="inp" value={model} onChange={(e) => setModel(e.target.value)} data-testid="ai-model" /></Field>
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={busy || (!key && model === st?.model)} onClick={() => void save({ ...(key ? { api_key: key } : {}), model })} data-testid="save-ai">Save</button>
        {st?.source === 'settings' && <button className="btn danger" disabled={busy} onClick={() => void save({ api_key: '' })}>Remove stored key</button>}
        {st?.source === 'env' && <span className="muted small">The key comes from the server’s ANTHROPIC_API_KEY environment variable.</span>}
      </div>
    </Card>
  )
}

type FTab = 'general' | 'rates' | 'machines' | 'materials' | 'crews' | 'services' | 'json'
const SETTING_FIELDS: [string, string][] = [
  ['fx_thb_per_usd', 'FX THB per USD'], ['thb_to_usd_factor', 'THB→USD factor'], ['usd_to_thb_factor', 'USD→THB factor'], ['ovh_pct', 'Overhead (fraction)'], ['risk_pct', 'Risk (fraction)'],
  ['margin_divisor', 'Margin divisor'], ['item_round_digits', 'Item round digits'], ['ces_round_digits', 'CES round digits'], ['ces_discount_pct', 'CES discount (fraction)'], ['quote_discount_pct', 'Quotation discount (fraction)'], ['set_qty', 'Set quantity'],
]

function FactorySettings() {
  const toast = useToast()
  const [fac, setFac] = useState<Factory | null>(null)
  const [saved, setSaved] = useState('')
  const [tab, setTab] = useState<FTab>('general')
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [json, setJson] = useState('')
  const [jsonErr, setJsonErr] = useState('')
  const load = useCallback(() => { api.get<Factory>('/api/settings/factory').then((f) => { setFac(f); setSaved(JSON.stringify(f)); setJson(JSON.stringify(f, null, 2)) }).catch(setErr) }, [])
  useEffect(load, [load])
  const dirty = useMemo(() => !!fac && JSON.stringify(fac) !== saved, [fac, saved])
  const upd = useCallback((fn: (f: Factory) => void) => setFac((p) => { if (!p) return p; const d = structuredClone(p); fn(d); return d }), [])
  async function save() {
    if (!fac) return
    setBusy(true)
    try { await api.put('/api/settings/factory', fac); setSaved(JSON.stringify(fac)); setJson(JSON.stringify(fac, null, 2)); toast.ok('Factory defaults saved — applies to new projects') } catch (e) { toast.err(e) } finally { setBusy(false) }
  }
  if (err) return <ErrorBox error={err} onRetry={load} />
  if (!fac) return <Spinner label="Loading factory defaults…" />
  const rateOpts = fac.labor_rates.map((r) => ({ value: r.id, label: `${r.position} (${r.id})` }))
  return (
    <Card
      title="Factory defaults"
      actions={<><span className={`dirty${dirty ? ' on' : ''}`}>{dirty ? '● Unsaved changes' : '✓ Saved'}</span><button className="btn" onClick={load} disabled={!dirty}>Discard</button><button className="btn primary" onClick={() => void save()} disabled={!dirty || busy} data-testid="save-factory">{busy ? 'Saving…' : 'Save factory defaults'}</button></>}
    >
      <p className="muted small">These templates seed every <em>new</em> project (existing projects keep their own copy). Crew templates should list roles with 0 persons — persons and days are estimated per job.</p>
      <Tabs<FTab> value={tab} onChange={setTab} tabs={[
        { id: 'general', label: 'General' }, { id: 'rates', label: <>Labor rates <Badge>{fac.labor_rates.length}</Badge></> }, { id: 'machines', label: <>Machines <Badge>{fac.machines.length}</Badge></> },
        { id: 'materials', label: <>Materials <Badge>{fac.materials.length}</Badge></> }, { id: 'crews', label: <>Crews <Badge>{fac.crews.length}</Badge></> }, { id: 'services', label: <>Service catalog <Badge>{fac.service_catalog.length}</Badge></> }, { id: 'json', label: 'Raw JSON' },
      ]} />
      {tab === 'general' && (
        <div className="stack">
          <h4>Pricing settings</h4>
          <div className="form-grid cols4">
            {SETTING_FIELDS.map(([k, label]) => <Field key={k} label={label}><NumIn value={fac.settings[k] as never} onChange={(v) => upd((f) => { R(f.settings)[k] = v })} /></Field>)}
            <Field label="Quote currency"><SelIn value={fac.settings.quote_currency} options={[{ value: 'USD', label: 'USD' }, { value: 'THB', label: 'THB' }]} onChange={(v) => upd((f) => { f.settings.quote_currency = v })} /></Field>
            <Field label="Header price mode"><SelIn value={fac.settings.header_price_mode} options={['ces', 'sum_items', 'manual'].map((x) => ({ value: x, label: x }))} onChange={(v) => upd((f) => { f.settings.header_price_mode = v as never })} /></Field>
            <Field label="FX date"><TextIn value={fac.settings.fx_date as string} onChange={(v) => upd((f) => { f.settings.fx_date = v })} /></Field>
          </div>
          <h4>Labor parameters</h4>
          <div className="form-grid cols4">
            <Field label="Salary adjustment factor"><NumIn value={fac.labor_params.salary_adj} onChange={(v) => upd((f) => { f.labor_params.salary_adj = v })} /></Field>
            <Field label="Working days per month"><NumIn value={fac.labor_params.days_per_month} onChange={(v) => upd((f) => { f.labor_params.days_per_month = v })} /></Field>
            <Field label="Hours per day"><NumIn value={fac.labor_params.hours_per_day} onChange={(v) => upd((f) => { f.labor_params.hours_per_day = v })} /></Field>
          </div>
          <h4>Machine parameters</h4>
          <div className="form-grid cols4">
            <Field label="Machine hours per year"><NumIn value={fac.machine_params.hours_per_year} onChange={(v) => upd((f) => { f.machine_params.hours_per_year = v })} /></Field>
            <Field label="Depreciation years"><NumIn value={fac.machine_params.dep_years} onChange={(v) => upd((f) => { f.machine_params.dep_years = v })} /></Field>
            <Field label="Electricity THB/kWh"><NumIn value={fac.machine_params.electricity_rate} onChange={(v) => upd((f) => { f.machine_params.electricity_rate = v })} /></Field>
            <Field label="Operator = labor rate"><SelIn value={fac.machine_params.operator_rate_id} options={rateOpts} placeholder="— manual —" onChange={(v) => upd((f) => { f.machine_params.operator_rate_id = v || null })} /></Field>
          </div>
          <h4>Supplier prices</h4>
          <div className="form-grid cols4"><Field label="Flag prices older than (days)"><NumIn value={fac.price_max_age_days} onChange={(v) => upd((f) => { f.price_max_age_days = typeof v === 'number' ? v : 90 })} /></Field></div>
        </div>
      )}
      {tab === 'rates' && (
        <DataTable path="labor_rates" rows={fac.labor_rates} maxHeight={520}
          cols={[
            { key: 'id', label: 'ID', w: 60 }, { key: 'position', label: 'Position', w: 180 }, { key: 'site', label: 'Site', w: 120 },
            { key: 'salary', label: 'Monthly salary THB', kind: 'num', w: 120 }, { key: 'hourly_rate', label: 'Hourly override', kind: 'num', w: 100 }, { key: 'note', label: 'Note', w: 160 }, { key: 'optional', label: 'Optional', kind: 'chk' },
          ] as Col<Factory['labor_rates'][number]>[]}
          onCell={(i, k, v) => upd((f) => { R(f.labor_rates[i])[k] = v })}
          onAdd={() => upd((f) => { let n = f.labor_rates.length + 1; while (f.labor_rates.some((r) => r.id === `L${n}`)) n++; f.labor_rates.push({ id: `L${n}`, position: '', site: '', salary: null }) })}
          onDelete={(i) => upd((f) => { f.labor_rates.splice(i, 1) })} onMove={(i, d) => upd((f) => { f.labor_rates = moveItem(f.labor_rates, i, i + d) })} addLabel="Add labor rate" />
      )}
      {tab === 'machines' && (
        <DataTable path="machines" rows={fac.machines} maxHeight={520}
          cols={[
            { key: 'name', label: 'Machine', w: 220 }, { key: 'description', label: 'Description', w: 160 }, { key: 'price', label: 'Price THB', kind: 'num', w: 110 }, { key: 'kwh', label: 'kWh/h', kind: 'num', w: 70 },
            { key: 'consumable_ratio', label: 'Consumables ratio', kind: 'num', w: 100 }, { key: 'rate_override', label: 'Rate override', kind: 'num', w: 100 },
          ] as Col<Factory['machines'][number]>[]}
          onCell={(i, k, v) => upd((f) => { R(f.machines[i])[k] = v })}
          onAdd={() => upd((f) => { f.machines.push({ name: '', description: '', price: null, kwh: null, consumable_ratio: null }) })}
          onDelete={(i) => upd((f) => { f.machines.splice(i, 1) })} onMove={(i, d) => upd((f) => { f.machines = moveItem(f.machines, i, i + d) })} addLabel="Add machine" />
      )}
      {tab === 'materials' && (
        <DataTable path="materials" rows={fac.materials} maxHeight={520}
          cols={[
            { key: 'code', label: 'Code', w: 60 }, { key: 'name', label: 'Material', w: 200 }, { key: 'thb_per_kg', label: 'THB / kg', kind: 'num', w: 100 }, { key: 'density', label: 'Density g/cm³', kind: 'num', w: 90 },
            { key: 'shape', label: 'Shape', kind: 'sel', opts: [{ value: 'TWL', label: 'TWL' }, { value: 'DiaL', label: 'DiaL' }, { value: 'ODTL', label: 'ODTL' }], w: 90 },
            { key: 'size_labels', label: 'Size labels (1 | 2 | 3)', kind: 'node', noPath: true, w: 240, node: (m: Material, i) => (
              <span className="size-labels">{[0, 1, 2].map((j) => <TextIn key={j} value={m.size_labels?.[j] ?? ''} onChange={(v) => upd((f) => { const a = [...(f.materials[i].size_labels || ['', '', ''])]; a[j] = v; f.materials[i].size_labels = a })} width={70} />)}</span>
            ) },
          ] as Col<Material>[]}
          onCell={(i, k, v) => upd((f) => { R(f.materials[i])[k] = v })}
          onAdd={() => upd((f) => { f.materials.push({ code: '', name: '', thb_per_kg: null, density: null, shape: 'TWL', size_labels: ['T=', 'W=', 'L='] }) })}
          onDelete={(i) => upd((f) => { f.materials.splice(i, 1) })} onMove={(i, d) => upd((f) => { f.materials = moveItem(f.materials, i, i + d) })} addLabel="Add material" />
      )}
      {tab === 'crews' && (
        <div className="stack">
          {fac.crews.map((c: Crew, ci) => (
            <div key={ci} className="subcard">
              <div className="form-grid cols4">
                <Field label="Crew ID"><TextIn value={c.id} onChange={(v) => upd((f) => { f.crews[ci].id = v })} /></Field>
                <Field label="Name"><TextIn value={c.name} onChange={(v) => upd((f) => { f.crews[ci].name = v })} /></Field>
                <Field label="Per diem THB"><NumIn value={c.per_diem} onChange={(v) => upd((f) => { f.crews[ci].per_diem = v })} /></Field>
                <Field label=" "><button className="btn sm danger" onClick={() => upd((f) => { f.crews.splice(ci, 1) })}>Delete crew</button></Field>
              </div>
              <DataTable path={`crews.${ci}.members`} rows={c.members} numbered={false}
                cols={[{ key: 'role', label: 'Role', w: 220 }, { key: 'rate_id', label: 'Labor rate', kind: 'sel', opts: rateOpts, w: 200 }, { key: 'persons', label: 'Default persons', kind: 'num', w: 100 }] as Col<Crew['members'][number]>[]}
                onCell={(mi, k, v) => upd((f) => { R(f.crews[ci].members[mi])[k] = v })} onAdd={() => upd((f) => { f.crews[ci].members.push({ role: '', rate_id: '', persons: 0 }) })}
                onDelete={(mi) => upd((f) => { f.crews[ci].members.splice(mi, 1) })} addLabel="Add role" />
            </div>
          ))}
          <div><button className="btn" onClick={() => upd((f) => { f.crews.push({ id: `crew${f.crews.length + 1}`, name: 'New crew', days: null, per_diem: 0, ot15_hours: 0, ot3_hours: 0, confined_pct: 0, members: [], extras_per_day: [] }) })}>+ Add crew template</button></div>
        </div>
      )}
      {tab === 'services' && (
        <DataTable path="service_catalog" rows={fac.service_catalog} maxHeight={520}
          cols={[
            { key: 'group', label: 'Group', w: 110 }, { key: 'name', label: 'Service', w: 230 }, { key: 'amount', label: 'Fixed amount', kind: 'num', w: 110 }, { key: 'rate', label: 'Rate', kind: 'num', w: 80 }, { key: 'qty', label: 'Qty', kind: 'num', w: 70 },
            { key: 'minimum', label: 'Minimum', kind: 'num', w: 80 }, { key: 'currency', label: 'Cur.', kind: 'sel', opts: [{ value: 'THB', label: 'THB' }, { value: 'USD', label: 'USD' }], w: 70 }, { key: 'unit', label: 'Unit', w: 90 }, { key: 'source', label: 'Source', w: 200 },
          ] as Col<Service>[]}
          onCell={(i, k, v) => upd((f) => { R(f.service_catalog[i])[k] = v })}
          onAdd={() => upd((f) => { f.service_catalog.push({ group: '', name: '', amount: null, currency: 'THB', unit: 'Cost /Job', source: '' }) })}
          onDelete={(i) => upd((f) => { f.service_catalog.splice(i, 1) })} onMove={(i, d) => upd((f) => { f.service_catalog = moveItem(f.service_catalog, i, i + d) })} addLabel="Add catalog service" />
      )}
      {tab === 'json' && (
        <div>
          <p className="muted small">Raw factory JSON (includes price-sheet / quote-item / quotation templates that have no table editor). “Apply” loads it into the editor; then save.</p>
          <textarea className="inp mono" rows={24} value={json} onChange={(e) => { setJson(e.target.value); setJsonErr('') }} spellCheck={false} />
          {jsonErr && <div className="alert err">{jsonErr}</div>}
          <div className="btn-row" style={{ marginTop: 8 }}><button className="btn" onClick={() => { try { setFac(JSON.parse(json) as Factory); setJsonErr('') } catch (e) { setJsonErr((e as Error).message) } }}>Apply JSON</button></div>
        </div>
      )}
    </Card>
  )
}
