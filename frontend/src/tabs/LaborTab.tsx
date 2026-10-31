import type { Crew, CrewExtra, CrewMember, LaborRate } from '../api/types'
import { api } from '../api/client'
import { Calc, NumIn, TextIn } from '../components/fields'
import { DataTable } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Card, Field, Sums, useToast } from '../components/ui'
import { useEditor } from '../editor'
import { uid } from '../lib/format'
import { R, moveItem } from '../lib/path'
import type { Factory } from '../api/types'

export function LaborTab() {
  const { est, edit, result } = useEditor()
  const toast = useToast()
  const lp = est.labor_params
  const rateOpts = est.labor_rates.map((r) => ({ value: r.id, label: `${r.position} (${r.id})` }))
  const rateCols: Col<LaborRate>[] = [
    { key: 'id', label: 'ID', kind: 'node', noPath: true, w: 50, node: (r) => <code>{r.id}</code> },
    { key: 'position', label: 'Position', w: 160 },
    { key: 'site', label: 'Site', w: 110 },
    { key: 'salary', label: 'Monthly salary THB', kind: 'num', w: 120, disabled: (r) => r.hourly_rate != null && r.hourly_rate !== '' },
    { key: 'hourly_rate', label: 'Hourly rate override', kind: 'num', w: 110, title: 'If set, replaces the rate computed from salary' },
    { key: 'note', label: 'Note', w: 150 },
    { key: 'rate', label: 'Rate THB/h', kind: 'calc', calc: (r, i) => ({ k: `rate.${result.labor_rates[i]?.id ?? r.id}`, v: result.labor_rates[i]?.rate, strong: true }) },
  ]

  async function addCrew() {
    const name = window.prompt('Crew name (e.g. In-House, Onsite)')
    if (!name) return
    let members: CrewMember[] = []
    try {
      const f = await api.get<Factory>('/api/settings/factory')
      members = structuredClone(f.crews?.[0]?.members || []).map((m) => ({ ...m, persons: 0 }))
    } catch { /* template unavailable: start empty */ }
    edit((e) => {
      e.crews.push({ id: uid('c'), name, days: null, per_diem: 0, ot15_hours: 0, ot3_hours: 0, confined_pct: 0, members, extras_per_day: [] })
    })
    toast.info('Crew added with role template (0 persons) — enter persons and days')
  }

  return (
    <div className="stack">
      <Card title="Labor parameters">
        <div className="form-grid cols4">
          <Field label="Salary adjustment factor" hint="hourly rate = salary × adj ÷ days ÷ hours"><NumIn path="labor_params.salary_adj" value={lp.salary_adj} onChange={(v) => edit((e) => { e.labor_params.salary_adj = v })} /></Field>
          <Field label="Working days per month"><NumIn path="labor_params.days_per_month" value={lp.days_per_month} onChange={(v) => edit((e) => { e.labor_params.days_per_month = v })} /></Field>
          <Field label="Hours per day"><NumIn path="labor_params.hours_per_day" value={lp.hours_per_day} onChange={(v) => edit((e) => { e.labor_params.hours_per_day = v })} /></Field>
        </div>
      </Card>

      <Card title="Labor rates" flush>
        <DataTable
          path="labor_rates"
          rows={est.labor_rates}
          cols={rateCols}
          maxHeight={420}
          onCell={(i, k, v) => edit((e) => { R(e.labor_rates[i])[k] = v })}
          onAdd={() => edit((e) => { let n = e.labor_rates.length + 1; while (e.labor_rates.some((r) => r.id === `L${n}`)) n++; e.labor_rates.push({ id: `L${n}`, position: '', site: '', salary: null, note: '' }) })}
          addLabel="Add labor rate"
          onDelete={(i) => {
            const id = est.labor_rates[i].id
            const used = est.crews.some((c) => c.members.some((m) => m.rate_id === id)) || est.machine_params.operator_rate_id === id
            if (used && !window.confirm(`Rate ${id} is used by a crew member or machine operator. Delete anyway?`)) return
            edit((e) => { e.labor_rates.splice(i, 1) })
          }}
          onMove={(i, d) => edit((e) => { e.labor_rates = moveItem(e.labor_rates, i, i + d) })}
        />
      </Card>

      {est.crews.map((c, ci) => <CrewCard key={ci} ci={ci} crew={c} rateOpts={rateOpts} />)}
      <div><button className="btn" onClick={() => void addCrew()}>+ Add crew</button></div>
    </div>
  )
}

function CrewCard({ ci, crew, rateOpts }: { ci: number; crew: Crew; rateOpts: { value: string; label: string }[] }) {
  const { edit, result } = useEditor()
  const rc = result.crews[ci]
  const cid = rc?.id ?? crew.id
  const set = (k: string, v: unknown) => edit((e) => { R(e.crews[ci])[k] = v })
  const memberCols: Col<CrewMember>[] = [
    { key: 'role', label: 'Role', w: 200 },
    { key: 'rate_id', label: 'Labor rate', kind: 'sel', opts: rateOpts, w: 190 },
    { key: 'persons', label: 'Persons', kind: 'num', w: 80 },
    { key: 'rate', label: 'Rate THB/h', kind: 'calc', calc: (_m, mi) => ({ v: rc?.members[mi]?.rate }) },
    { key: 'day', label: 'THB / person-day', kind: 'calc', calc: (_m, mi) => ({ v: rc?.members[mi]?.day_rate }) },
    { key: 'cost', label: 'Cost / day THB', kind: 'calc', calc: (_m, mi) => ({ k: `crew.${cid}.m${mi}`, v: rc?.members[mi]?.cost_per_day, strong: true }) },
  ]
  const extraCols: Col<CrewExtra>[] = [
    { key: 'name', label: 'Extra cost per day', w: 220 },
    { key: 'amount', label: 'Amount THB', kind: 'num', w: 100 },
    { key: 'basis', label: 'Basis', kind: 'sel', opts: [{ value: 'fixed', label: 'fixed / day' }, { value: 'per_person', label: 'per person' }], w: 110 },
    { key: 'persons_per_unit', label: 'Persons per unit', kind: 'num', w: 90, disabled: (x) => x.basis !== 'per_person', title: 'e.g. 2 persons share one room' },
    { key: 'cost', label: 'Cost / day THB', kind: 'calc', calc: (_x, xi) => ({ k: `crew.${cid}.x${xi}`, v: result.nodes[`crew.${cid}.x${xi}`]?.value }) },
  ]
  return (
    <Card
      dataRow={`crews.${ci}`}
      title={<>Crew: {crew.name}</>}
      actions={<><span className="muted small">Per day </span><Calc k={`crew.${cid}.per_day`} v={rc?.per_day} /><span className="muted small" style={{ marginLeft: 10 }}>Total </span><Calc k={`crew.${cid}.total`} v={rc?.total_thb} strong unit="THB" /><button className="btn sm danger" style={{ marginLeft: 12 }} onClick={() => { if (window.confirm(`Delete crew "${crew.name}"?`)) edit((e) => { e.crews.splice(ci, 1) }) }}>Delete crew</button></>}
      flush
    >
      <div className="sheet-params">
        <Field label="Crew name"><TextIn path={`crews.${ci}.name`} value={crew.name} onChange={(v) => set('name', v)} /></Field>
        <Field label="Working days"><NumIn path={`crews.${ci}.days`} value={crew.days} onChange={(v) => set('days', v)} /></Field>
        <Field label="Per diem / person / day THB"><NumIn path={`crews.${ci}.per_diem`} value={crew.per_diem} onChange={(v) => set('per_diem', v)} /></Field>
        <Field label="OT ×1.5 hours / day"><NumIn path={`crews.${ci}.ot15_hours`} value={crew.ot15_hours} onChange={(v) => set('ot15_hours', v)} /></Field>
        <Field label="OT ×3 hours / day"><NumIn path={`crews.${ci}.ot3_hours`} value={crew.ot3_hours} onChange={(v) => set('ot3_hours', v)} /></Field>
        <Field label="Confined-space premium (fraction)"><NumIn path={`crews.${ci}.confined_pct`} pct value={crew.confined_pct} onChange={(v) => set('confined_pct', v)} /></Field>
      </div>
      <DataTable
        path={`crews.${ci}.members`}
        rows={crew.members}
        cols={memberCols}
        onCell={(mi, k, v) => edit((e) => { R(e.crews[ci].members[mi])[k] = v })}
        onAdd={() => edit((e) => { e.crews[ci].members.push({ role: '', rate_id: '', persons: null }) })}
        addLabel="Add role"
        onDelete={(mi) => edit((e) => { e.crews[ci].members.splice(mi, 1) })}
        onMove={(mi, d) => edit((e) => { e.crews[ci].members = moveItem(e.crews[ci].members, mi, mi + d) })}
        toolbar={<Sums items={[{ label: 'Crew cost per day (members + extras)', value: <Calc k={`crew.${cid}.per_day`} v={rc?.per_day} strong /> }, { label: 'Crew total THB', value: <Calc k={`crew.${cid}.total`} v={rc?.total_thb} strong />, grand: true }]} />}
      />
      <div className="freight">
        <DataTable
          path={`crews.${ci}.extras_per_day`}
          rows={crew.extras_per_day || []}
          cols={extraCols}
          numbered={false}
          onCell={(xi, k, v) => edit((e) => { R(e.crews[ci].extras_per_day[xi])[k] = v })}
          onAdd={() => edit((e) => { (e.crews[ci].extras_per_day ||= []).push({ name: '', amount: null, basis: 'fixed' }) })}
          addLabel="Add extra cost"
          onDelete={(xi) => edit((e) => { e.crews[ci].extras_per_day.splice(xi, 1) })}
          empty="No extra daily costs (accommodation, vehicle…)"
        />
      </div>
    </Card>
  )
}
