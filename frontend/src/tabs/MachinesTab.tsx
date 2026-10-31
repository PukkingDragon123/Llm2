import type { Machine } from '../api/types'
import { NumIn, SelIn } from '../components/fields'
import { DataTable } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Card, Field } from '../components/ui'
import { useEditor } from '../editor'
import { R, moveItem } from '../lib/path'

export function MachinesTab() {
  const { est, edit, result } = useEditor()
  const mp = est.machine_params
  const rateOpts = est.labor_rates.map((r) => ({ value: r.id, label: `${r.position} (${r.id})` }))
  const cols: Col<Machine>[] = [
    { key: 'name', label: 'Machine', w: 210 },
    { key: 'description', label: 'Description', w: 160 },
    { key: 'price', label: 'Machine price THB', kind: 'num', w: 120 },
    { key: 'kwh', label: 'kWh / h', kind: 'num', w: 70 },
    { key: 'consumable_ratio', label: 'Consumables ratio / yr', kind: 'num', w: 110 },
    { key: 'rate_override', label: 'Rate override THB/h', kind: 'num', w: 110, title: 'Manual rate; replaces the calculated one' },
    { key: 'rate', label: 'Rate THB/h', kind: 'calc', calc: (_m, i) => ({ k: `mach.${i}`, v: result.machines[i]?.rate, strong: true }) },
  ]
  return (
    <div className="stack">
      <Card title="Machine-hour rate parameters">
        <p className="muted small">Rate = ROUNDUP(price ÷ hours/yr ÷ years + price × consumables ÷ hours/yr + kWh × electricity + operator, 0)</p>
        <div className="form-grid cols4">
          <Field label="Machine hours per year"><NumIn path="machine_params.hours_per_year" value={mp.hours_per_year} onChange={(v) => edit((e) => { e.machine_params.hours_per_year = v })} /></Field>
          <Field label="Depreciation years"><NumIn path="machine_params.dep_years" value={mp.dep_years} onChange={(v) => edit((e) => { e.machine_params.dep_years = v })} /></Field>
          <Field label="Electricity rate THB/kWh"><NumIn path="machine_params.electricity_rate" value={mp.electricity_rate} onChange={(v) => edit((e) => { e.machine_params.electricity_rate = v })} /></Field>
          <Field label="Operator = labor rate"><SelIn path="machine_params.operator_rate_id" value={mp.operator_rate_id} options={rateOpts} placeholder="— manual rate —" onChange={(v) => edit((e) => { e.machine_params.operator_rate_id = v || null })} /></Field>
          <Field label="Operator rate THB/h (manual)"><NumIn path="machine_params.operator_rate" value={mp.operator_rate} disabled={!!mp.operator_rate_id} onChange={(v) => edit((e) => { e.machine_params.operator_rate = v })} /></Field>
        </div>
      </Card>
      <Card title={`Machines (${est.machines.length})`} flush>
        <DataTable
          path="machines"
          rows={est.machines}
          cols={cols}
          maxHeight="calc(100vh - 380px)"
          onCell={(i, k, v) =>
            edit((e) => {
              const old = e.machines[i].name
              R(e.machines[i])[k] = v
              if (k === 'name' && typeof v === 'string' && old !== v) {
                // keep part process references in sync with the renamed machine
                for (const p of e.parts) for (const pr of p.processes || []) if (pr.machine === old) pr.machine = v
              }
            })
          }
          onAdd={() => edit((e) => { e.machines.push({ name: '', description: '', price: null, kwh: null, consumable_ratio: null }) })}
          addLabel="Add machine"
          onDelete={(i) => {
            const nm = est.machines[i].name
            const used = est.parts.filter((p) => (p.processes || []).some((x) => x.machine === nm)).length
            if (used && !window.confirm(`"${nm}" is used by ${used} part(s). Delete anyway?`)) return
            edit((e) => { e.machines.splice(i, 1) })
          }}
          onMove={(i, d) => edit((e) => { e.machines = moveItem(e.machines, i, i + d) })}
        />
      </Card>
    </div>
  )
}
