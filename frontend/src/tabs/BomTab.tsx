import { useEffect, useMemo, useState } from 'react'
import type { Part } from '../api/types'
import { Calc, NumIn, SelIn } from '../components/fields'
import { DataTable } from '../components/DataTable'
import type { Col } from '../components/DataTable'
import { Card, Sums } from '../components/ui'
import { useEditor } from '../editor'
import { fmt, uid } from '../lib/format'
import { moveItem } from '../lib/path'

const SHAPES = [
  { value: 'TWL', label: 'TWL (plate T×W×L)' },
  { value: 'DiaL', label: 'DiaL (bar Dia×L)' },
  { value: 'ODTL', label: 'ODTL (pipe OD×T×L)' },
]
const SHAPE_LABELS: Record<string, string[]> = { TWL: ['T', 'W', 'L'], DiaL: ['Dia', 'L', ''], ODTL: ['OD', 'T', 'L'] }

export function BomTab() {
  const { est, edit, result, focusPath } = useEditor()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const matOpts = useMemo(() => est.materials.map((m) => ({ value: m.code, label: m.name })), [est.materials])
  const machOpts = useMemo(() => est.machines.map((m) => ({ value: m.name, label: m.name })), [est.machines])

  useEffect(() => {
    const m = focusPath && /^parts\.(\d+)\.processes/.exec(focusPath)
    if (m) setOpen((s) => new Set(s).add(Number(m[1])))
  }, [focusPath])

  const labels = (p: Part): string[] => {
    const mat = est.materials.find((m) => m.code === p.grade_code)
    const shape = p.shape || mat?.shape || 'TWL'
    const base = SHAPE_LABELS[shape] || ['', '', '']
    return base.map((b) => (b ? `${b} mm` : '—'))
  }

  const cols: Col<Part>[] = [
    { key: 'name', label: 'Part name', w: 170, placeholder: 'e.g. Shell' },
    { key: 'group', label: 'Group', w: 110 },
    { key: 'grade_code', label: 'Material grade', kind: 'sel', opts: matOpts, w: 170 },
    { key: 'shape', label: 'Shape', kind: 'sel', opts: SHAPES, w: 110, placeholder: (p) => { const m = est.materials.find((x) => x.code === p.grade_code); return m?.shape ? `auto: ${m.shape}` : '—' } },
    { key: 's1', label: 'Size 1', kind: 'num', w: 72, placeholder: (p) => labels(p)[0] },
    { key: 's2', label: 'Size 2', kind: 'num', w: 72, placeholder: (p) => labels(p)[1] },
    { key: 's3', label: 'Size 3', kind: 'num', w: 72, placeholder: (p) => labels(p)[2], disabled: (p) => (p.shape || est.materials.find((m) => m.code === p.grade_code)?.shape) === 'DiaL' },
    { key: 'qty', label: 'Qty/set', kind: 'num', w: 64 },
    { key: 'w', label: 'Weight kg/pc', kind: 'calc', calc: (p, i) => ({ k: `part.${p.id || i}.weight`, v: result.parts[i]?.weight, dp: 3 }) },
    { key: 'tw', label: 'Total kg', kind: 'calc', calc: (_p, i) => ({ v: result.parts[i]?.total_weight, dp: 2 }) },
    { key: 'pricing', label: 'Pricing', kind: 'sel', opts: [{ value: 'price_sheet', label: 'price sheet' }, { value: 'by_weight', label: 'by weight' }], w: 100 },
    { key: 'unit_price_thb_kg', label: 'THB/kg', kind: 'num', w: 80, disabled: (p) => p.pricing !== 'by_weight', title: 'Unit price THB/kg (only for by-weight pricing; blank = material list price)' },
    { key: 'discount_pct', label: 'Disc %', kind: 'num', w: 62, disabled: (p) => p.pricing !== 'by_weight' },
    { key: 'mat', label: 'Material THB', kind: 'calc', calc: (p, i) => ({ k: `part.${p.id || i}.mat`, v: result.parts[i]?.material_cost_thb }) },
    {
      key: 'processes', label: 'Processes (machine · h)', w: 190, kind: 'node', noPath: true,
      node: (p, i) => {
        const ps = (p.processes || []).filter((x) => x.machine)
        return (
          <button className="link proc-toggle" data-testid="proc-toggle" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}>
            {open.has(i) ? '▾' : '▸'} {ps.length ? ps.map((x) => `${x.machine.replace(/^\d+\s*/, '')} ${x.hours ?? '?'}h`).join(' · ') : 'add…'}
          </button>
        )
      },
    },
    { key: 'machine_multiplier', label: 'Mach ×', kind: 'num', w: 60 },
    { key: 'mach', label: 'Machine THB', kind: 'calc', calc: (p, i) => ({ k: `part.${p.id || i}.mach`, v: result.parts[i]?.machine_cost_thb }) },
    { key: 'remark', label: 'Remark', w: 130 },
  ]

  function onCell(i: number, key: string, value: unknown) {
    edit((e) => {
      const p = e.parts[i]
      if (!p) return
      ;(p as Record<string, unknown>)[key] = value
      if (key === 'grade_code') {
        const m = e.materials.find((x) => x.code === value)
        p.grade = m?.name || ''
        if (m?.shape) p.shape = m.shape
      }
    })
  }
  function add() {
    edit((e) => {
      e.parts.push({ id: uid('p'), group: '', name: '', grade_code: '', grade: '', shape: 'TWL', s1: null, s2: null, s3: null, qty: null, pricing: 'price_sheet', processes: [], remark: '' })
    })
  }
  const totals = result.parts.reduce((a, p) => ({ w: a.w + (p.total_weight || 0), m: a.m + p.material_cost_thb, c: a.c + p.machine_cost_thb }), { w: 0, m: 0, c: 0 })

  return (
    <div className="stack">
      <Card title={`Bill of materials / parts (${est.parts.length})`} flush actions={<span className="muted small">Weight is calculated from dimensions & density; “price sheet” parts are bought via a supplier price sheet (no THB/kg needed).</span>}>
        <DataTable
          path="parts"
          rows={est.parts}
          cols={cols}
          maxHeight="calc(100vh - 290px)"
          onCell={onCell}
          onAdd={add}
          addLabel="Add part"
          onDelete={(i) => edit((e) => { e.parts.splice(i, 1) })}
          onDuplicate={(i) => edit((e) => { const c = structuredClone(e.parts[i]); c.id = uid('p'); c.name = `${c.name} (copy)`; e.parts.splice(i + 1, 0, c) })}
          onMove={(i, d) => edit((e) => { e.parts = moveItem(e.parts, i, i + d) })}
          expanded={open}
          renderExpanded={(p, i) => (
            <ProcessEditor i={i} part={p} machOpts={machOpts} />
          )}
          toolbar={<Sums items={[
            { label: 'Total weight', value: <span className="num">{fmt(totals.w)} kg</span> },
            { label: 'Material (by weight) THB', value: <span className="num">{fmt(totals.m)}</span> },
            { label: 'Machine THB', value: <span className="num">{fmt(totals.c)}</span>, grand: true },
          ]} />}
        />
      </Card>
    </div>
  )
}

function ProcessEditor({ i, part, machOpts }: { i: number; part: Part; machOpts: { value: string; label: string }[] }) {
  const { edit, result, est } = useEditor()
  const procs = part.processes || []
  // result processes skip rows with an empty machine
  let k = -1
  return (
    <div className="proc-editor">
      <strong>Processes for “{part.name || `part ${i + 1}`}”</strong> <span className="muted small">(up to 5 machine steps; cost = rate × hours × multiplier)</span>
      <table className="dt compact">
        <thead><tr><th>Machine</th><th className="r">Hours</th><th className="r">Rate THB/h</th><th className="r">Amount THB</th><th /></tr></thead>
        <tbody>
          {procs.map((pr, j) => {
            if (pr.machine) k++
            const rp = pr.machine ? result.parts[i]?.processes?.[k] : undefined
            const rec = rp as unknown as { rate: number; amount: number } | undefined
            return (
              <tr key={j} data-row={`parts.${i}.processes.${j}`}>
                <td><SelIn path={`parts.${i}.processes.${j}.machine`} value={pr.machine} options={machOpts} onChange={(v) => edit((e) => { e.parts[i].processes![j].machine = v })} /></td>
                <td className="r"><NumIn path={`parts.${i}.processes.${j}.hours`} value={pr.hours} onChange={(v) => edit((e) => { e.parts[i].processes![j].hours = v })} /></td>
                <td className="r"><Calc v={rec?.rate} /></td>
                <td className="r"><Calc k={`part.${part.id || i}.p${j}`} v={rec?.amount} /></td>
                <td className="act"><button className="icon-btn danger" onClick={() => edit((e) => { e.parts[i].processes!.splice(j, 1) })} aria-label="Remove process">✕</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button className="btn sm" disabled={procs.length >= 5 || est.machines.length === 0} onClick={() => edit((e) => { (e.parts[i].processes ||= []).push({ machine: '', hours: null }) })}>+ Add process</button>
    </div>
  )
}
