import { useState } from 'react'
import { api, runJob } from '../api/client'
import type { Estimate, EstimateSuggestion, Questions, SuggestionPayload } from '../api/types'
import { Badge, Card, ErrorBox, Spinner, copyText, useToast } from '../components/ui'
import { useEditor } from '../editor'
import { fmtDate, uid } from '../lib/format'

const norm = (s: string) => s.trim().toLowerCase()

function findPart(est: Estimate, ref: string): number {
  const r = norm(ref)
  let i = est.parts.findIndex((p) => norm(String(p.id)) === r)
  if (i < 0) i = est.parts.findIndex((p) => norm(p.name) === r)
  if (i < 0) i = est.parts.findIndex((p) => r && (norm(p.name).includes(r) || r.includes(norm(p.name))) && norm(p.name) !== '')
  return i
}

export function AiTab() {
  const { id, est, edit, proj } = useEditor()
  const toast = useToast()
  const stored = (proj.meta as { ai_suggestion?: SuggestionPayload }).ai_suggestion
  const [payload, setPayload] = useState<SuggestionPayload | null>(stored ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const [crewIdx, setCrewIdx] = useState(0)
  const [qBusy, setQBusy] = useState(false)
  const [qErr, setQErr] = useState<unknown>(null)
  const [qs, setQs] = useState<Questions | null>(null)

  async function suggest() {
    setBusy(true)
    setErr(null)
    try {
      const r = await runJob<SuggestionPayload>(api.post<{ job_id: string }>(`/api/projects/${id}/ai/suggest`))
      setPayload({ ...r, at: new Date().toISOString() })
      setApplied(new Set())
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  async function consolidate() {
    setQBusy(true)
    setQErr(null)
    try {
      const r = await runJob<{ questions: Questions }>(api.post<{ job_id: string }>(`/api/projects/${id}/ai/questions`))
      setQs(r.questions)
    } catch (e) {
      setQErr(e)
    } finally {
      setQBusy(false)
    }
  }
  const mark = (k: string) => setApplied((s) => new Set(s).add(k))
  const s: EstimateSuggestion | undefined = payload?.suggestion

  function applyCrewDays() {
    if (s?.crew_days == null) return
    edit((e) => { if (e.crews[crewIdx]) e.crews[crewIdx].days = s.crew_days! })
    mark('days'); toast.ok(`Crew days set on “${est.crews[crewIdx]?.name}”`)
  }
  function applyCrew(i: number) {
    const c = s!.crew[i]
    edit((e) => {
      const crew = e.crews[crewIdx]
      if (!crew) return
      let m = crew.members.find((x) => x.rate_id === c.rate_id && norm(x.role) === norm(c.role))
      if (!m) m = crew.members.find((x) => norm(x.role) === norm(c.role))
      if (!m) { m = { role: c.role, rate_id: c.rate_id, persons: c.persons }; crew.members.push(m) }
      else { m.persons = c.persons; if (!m.rate_id) m.rate_id = c.rate_id }
    })
    mark(`crew-${i}`); toast.ok(`${c.role}: ${c.persons} persons applied`)
  }
  function applyProcess(i: number) {
    const p = s!.processes[i]
    const pi = findPart(est, p.part_ref)
    if (pi < 0) return
    edit((e) => {
      const part = e.parts[pi]
      const list = (part.processes ||= [])
      const ex = list.find((x) => x.machine === p.machine)
      if (ex) ex.hours = p.hours
      else list.push({ machine: p.machine, hours: p.hours })
    })
    mark(`proc-${i}`); toast.ok(`${p.machine} ${p.hours} h → ${est.parts[pi].name}`)
  }
  function applyService(i: number) {
    const v = s!.services[i]
    edit((e) => {
      const src = `AI suggestion — ${v.evidence}`
      if (v.basis === 'fixed_from_history' || (v.rate == null && v.amount != null)) e.services.push({ id: uid('s'), group: v.group, name: v.name, amount: v.amount ?? null, currency: v.currency, unit: 'Cost /Job', source: src })
      else e.services.push({ id: uid('s'), group: v.group, name: v.name, rate: v.rate ?? null, qty: v.qty ?? null, minimum: v.minimum ?? null, amount: v.amount ?? null, currency: v.currency, unit: 'unit', source: src })
    })
    mark(`svc-${i}`); toast.ok(`Service “${v.name}” appended`)
  }
  function applyNeed(i: number) {
    const n = s!.material_needs[i]
    const si = est.price_sheets.findIndex((x) => x.id === n.sheet)
    if (si < 0) return
    edit((e) => {
      e.price_sheets[si].lines.push({ id: uid('r'), group: n.group, material: n.material, description: n.description, qty: n.qty, unit_price: null, unit_weight: n.unit_weight_kg ?? null, price_source: '', supplier_price_id: null })
    })
    mark(`need-${i}`); toast.ok('Material need added without a price — it now shows as a missing supplier price')
  }

  return (
    <div className="stack">
      <Card
        title="Estimating assistant"
        actions={<button className="btn primary" onClick={() => void suggest()} disabled={busy} data-testid="ai-suggest">{busy ? 'Working…' : 'Suggest estimate'}</button>}
      >
        <p className="muted">
          Claude proposes crew, machine processes, services and material needs from the drawing data, BOM and similar historical projects, using only your own factory tables.
          It never proposes supplier prices: material needs are added <strong>without a price</strong> so they appear as missing inputs for purchasing. Nothing is applied until you press <em>Apply</em>.
        </p>
        {busy && <Spinner label="Claude is analysing the project and history… this can take a minute" />}
        <ErrorBox error={err} />
        {payload?.at && <p className="muted small">Suggestion generated {fmtDate(payload.at)}{payload.meta?.model ? ` · ${String(payload.meta.model)}` : ''}</p>}
      </Card>

      {s && (
        <>
          <Card title="Summary">
            <p>{s.confidence_note}</p>
            <div className="btn-row">
              <label className="field inline"><span className="field-label">Apply crew changes to</span>
                <select className="inp" value={crewIdx} onChange={(e) => setCrewIdx(Number(e.target.value))}>{est.crews.map((c, i) => <option key={i} value={i}>{c.name}</option>)}</select>
              </label>
            </div>
          </Card>
          <Card title="Crew days & roles" flush>
            <table className="dt compact">
              <thead><tr><th>Role</th><th>Labor rate</th><th className="r">Persons</th><th>Rationale</th><th /></tr></thead>
              <tbody>
                <tr>
                  <td><strong>Crew working days</strong></td><td />
                  <td className="r num">{s.crew_days ?? '—'}</td><td>{s.crew_days_rationale}</td>
                  <td><button className="btn sm" disabled={s.crew_days == null || applied.has('days')} onClick={applyCrewDays}>{applied.has('days') ? 'Applied' : 'Apply'}</button></td>
                </tr>
                {s.crew.map((c, i) => (
                  <tr key={i}>
                    <td>{c.role}</td><td>{est.labor_rates.find((r) => r.id === c.rate_id)?.position || c.rate_id} <code className="muted small">{c.rate_id}</code>{!est.labor_rates.some((r) => r.id === c.rate_id) && <Badge tone="red">unknown rate</Badge>}</td>
                    <td className="r num">{c.persons}</td><td>{c.rationale}</td>
                    <td><button className="btn sm" disabled={applied.has(`crew-${i}`) || !est.labor_rates.some((r) => r.id === c.rate_id)} onClick={() => applyCrew(i)}>{applied.has(`crew-${i}`) ? 'Applied' : 'Apply'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title={`Machine processes (${s.processes.length})`} flush>
            <table className="dt compact">
              <thead><tr><th>Part</th><th>Machine</th><th className="r">Hours</th><th>Rationale</th><th /></tr></thead>
              <tbody>
                {s.processes.map((p, i) => {
                  const pi = findPart(est, p.part_ref)
                  const mOk = est.machines.some((m) => m.name === p.machine)
                  return (
                    <tr key={i}>
                      <td>{p.part_ref} {pi < 0 ? <Badge tone="red">part not found</Badge> : <span className="muted small">→ {est.parts[pi].name}</span>}</td>
                      <td>{p.machine} {!mOk && <Badge tone="red">not in machine table</Badge>}</td>
                      <td className="r num">{p.hours}</td><td>{p.rationale}</td>
                      <td><button className="btn sm" disabled={pi < 0 || !mOk || applied.has(`proc-${i}`)} onClick={() => applyProcess(i)}>{applied.has(`proc-${i}`) ? 'Applied' : 'Apply'}</button></td>
                    </tr>
                  )
                })}
                {s.processes.length === 0 && <tr><td colSpan={5} className="empty-cell">No process suggestions</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title={`Services (${s.services.length})`} flush>
            <table className="dt compact">
              <thead><tr><th>Group</th><th>Service</th><th>Basis</th><th className="r">Amount / rate</th><th>Rationale &amp; evidence</th><th /></tr></thead>
              <tbody>
                {s.services.map((v, i) => (
                  <tr key={i}>
                    <td>{v.group}</td><td>{v.name}</td><td>{v.basis.replace(/_/g, ' ')}</td>
                    <td className="r num">{v.amount != null ? `${v.amount} ${v.currency}` : `${v.rate ?? '?'} × ${v.qty ?? '?'}${v.minimum != null ? ` (min ${v.minimum})` : ''} ${v.currency}`}</td>
                    <td>{v.rationale}<div className="muted small">Evidence: {v.evidence}</div></td>
                    <td><button className="btn sm" disabled={applied.has(`svc-${i}`)} onClick={() => applyService(i)}>{applied.has(`svc-${i}`) ? 'Applied' : 'Apply'}</button></td>
                  </tr>
                ))}
                {s.services.length === 0 && <tr><td colSpan={6} className="empty-cell">No service suggestions</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title={`Material needs (${s.material_needs.length}) — added without prices`} flush>
            <table className="dt compact">
              <thead><tr><th>Sheet</th><th>Group</th><th>Material</th><th>Description</th><th className="r">Qty</th><th>Rationale</th><th /></tr></thead>
              <tbody>
                {s.material_needs.map((n, i) => {
                  const ok = est.price_sheets.some((x) => x.id === n.sheet)
                  return (
                    <tr key={i}>
                      <td>{n.sheet} {!ok && <Badge tone="red">no such sheet</Badge>}</td><td>{n.group}</td><td>{n.material}</td><td>{n.description}</td>
                      <td className="r num">{n.qty}</td><td>{n.rationale}</td>
                      <td><button className="btn sm" disabled={!ok || applied.has(`need-${i}`)} onClick={() => applyNeed(i)}>{applied.has(`need-${i}`) ? 'Applied' : 'Add to price sheet'}</button></td>
                    </tr>
                  )
                })}
                {s.material_needs.length === 0 && <tr><td colSpan={7} className="empty-cell">No material suggestions</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title={`Questions for the team (${s.questions.length})`} actions={<button className="btn sm" onClick={() => void copyText(s.questions.map((q) => `- ${q}`).join('\n')).then(() => toast.ok('Copied'))}>Copy</button>}>
            <ul className="notes">{s.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </Card>
        </>
      )}

      <Card title="Open questions" actions={<button className="btn" onClick={() => void consolidate()} disabled={qBusy} data-testid="ai-questions">{qBusy ? 'Working…' : 'Consolidate open questions'}</button>}>
        <p className="muted small">Groups all missing inputs and unresolved drawing questions into non-duplicated lists for the customer, purchasing and engineering.</p>
        {qBusy && <Spinner label="Consolidating…" />}
        <ErrorBox error={qErr} />
        {qs && (
          <div className="q-groups">
            {([['for_customer', 'Customer'], ['for_purchasing', 'Purchasing'], ['for_engineering', 'Engineering']] as const).map(([k, label]) => (
              <div key={k} className="q-group">
                <h4>{label} <Badge>{qs[k].length}</Badge> <button className="link small" onClick={() => void copyText(qs[k].map((q, i) => `${i + 1}. ${q}`).join('\n')).then(() => toast.ok(`${label} questions copied`))}>copy</button></h4>
                <ol>{qs[k].map((q, i) => <li key={i}>{q}</li>)}</ol>
                {qs[k].length === 0 && <p className="muted small">None</p>}
              </div>
            ))}
            <button className="btn sm" onClick={() => void copyText([['Customer', qs.for_customer], ['Purchasing', qs.for_purchasing], ['Engineering', qs.for_engineering]].map(([t, l]) => `${t}:\n${(l as string[]).map((q, i) => `${i + 1}. ${q}`).join('\n')}`).join('\n\n')).then(() => toast.ok('All questions copied'))}>Copy all</button>
          </div>
        )}
      </Card>
    </div>
  )
}
