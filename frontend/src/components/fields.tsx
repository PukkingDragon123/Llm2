import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Issue, Num, TraceNodeFlat } from '../api/types'
import { evalNum, fmt, fmtPct, numToText, parseNumText, sameNum } from '../lib/format'

// ------------------------------------------------------------------ issue + trace context (provided by the project editor)
interface IssueCtxValue {
  byPath: Map<string, Issue[]>
  nodes: Record<string, TraceNodeFlat>
  openTrace: (key: string) => void
}
export const IssueCtx = createContext<IssueCtxValue>({ byPath: new Map(), nodes: {}, openTrace: () => {} })
export const useIssues = () => useContext(IssueCtx)

function useIssueClass(path?: string): string {
  const { byPath } = useIssues()
  if (!path) return ''
  const list = byPath.get(path)
  if (!list?.length) return ''
  if (list.some((i) => i.severity === 'missing')) return ' iss-missing'
  if (list.some((i) => i.severity === 'error')) return ' iss-error'
  if (list.some((i) => i.severity === 'warning')) return ' iss-warning'
  return ''
}
function useIssueTitle(path?: string): string | undefined {
  const { byPath } = useIssues()
  const list = path ? byPath.get(path) : undefined
  return list?.length ? list.map((i) => i.message).join('\n') : undefined
}

// ------------------------------------------------------------------ inputs
interface BaseProps {
  path?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  title?: string
  ariaLabel?: string
}

export function TextIn({ value, onChange, path, disabled, placeholder, className = '', title, ariaLabel, ...rest }: BaseProps & { value: string | null | undefined; onChange: (v: string) => void; list?: string; type?: string; width?: number }) {
  const cls = useIssueClass(path)
  const t = useIssueTitle(path)
  return (
    <input
      className={`inp${cls} ${className}`}
      type={rest.type || 'text'}
      value={value ?? ''}
      data-path={path}
      disabled={disabled}
      placeholder={placeholder}
      title={title || t}
      aria-label={ariaLabel}
      list={rest.list}
      style={rest.width ? { width: rest.width } : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Numeric input that accepts arithmetic expressions. Plain numbers are stored as numbers, expressions as strings. */
export function NumIn({ value, onChange, path, disabled, placeholder, className = '', pct, title, ariaLabel }: BaseProps & { value: Num | undefined; onChange: (v: Num) => void; pct?: boolean }) {
  const [txt, setTxt] = useState(numToText(value))
  useEffect(() => {
    setTxt((cur) => (sameNum(parseNumText(cur), value ?? null) ? cur : numToText(value)))
  }, [value])
  const cls = useIssueClass(path)
  const t = useIssueTitle(path)
  const isExpr = typeof value === 'string' && value.trim() !== '' && !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value.trim())
  const ev = pct || isExpr ? evalNum(value) : null
  return (
    <span className={`numwrap${pct || isExpr ? ' hasext' : ''}`}>
      <input
        className={`inp num${cls} ${className}`}
        inputMode="decimal"
        value={txt}
        data-path={path}
        disabled={disabled}
        placeholder={placeholder}
        title={title || t || (isExpr ? `= ${fmt(ev, 4)}` : undefined)}
        aria-label={ariaLabel}
        onChange={(e) => {
          setTxt(e.target.value)
          onChange(parseNumText(e.target.value))
        }}
      />
      {(pct && ev != null) && <span className="ext">{fmtPct(ev, 1)}</span>}
      {(!pct && isExpr && ev != null) && <span className="ext">={fmt(ev, 2)}</span>}
    </span>
  )
}

export interface Option { value: string; label: string }
export function SelIn({ value, onChange, options, path, disabled, placeholder, className = '', title }: BaseProps & { value: string | null | undefined; onChange: (v: string) => void; options: Option[] }) {
  const cls = useIssueClass(path)
  const t = useIssueTitle(path)
  const has = options.some((o) => o.value === (value ?? ''))
  return (
    <select className={`inp sel${cls} ${className}`} value={value ?? ''} data-path={path} disabled={disabled} title={title || t} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder ?? '—'}</option>
      {!has && value ? <option value={value}>{value} (unknown)</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function ChkIn({ value, onChange, path, disabled, label }: BaseProps & { value: boolean | undefined; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="chk">
      <input type="checkbox" checked={!!value} data-path={path} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

// ------------------------------------------------------------------ computed cell
export function Calc({ k, v, dp = 2, unit, pct, strong, className = '' }: { k?: string; v: number | null | undefined; dp?: number; unit?: string; pct?: boolean; strong?: boolean; className?: string }) {
  const { nodes, openTrace } = useIssues()
  const node = k ? nodes[k] : undefined
  const missing = node?.missing
  const text = v == null ? '—' : pct ? fmtPct(v, dp) : fmt(v, dp)
  if (!k || !node) return <span className={`calc plain num${strong ? ' strong' : ''} ${className}`}>{text}{unit ? <span className="unit"> {unit}</span> : null}</span>
  return (
    <button type="button" className={`calc num${missing ? ' is-missing' : ''}${strong ? ' strong' : ''} ${className}`} onClick={() => openTrace(k)} title={`Show calculation: ${k}`} data-calc={k}>
      <span className="fx">ƒ</span>
      <span className="val">{text}</span>
      {unit ? <span className="unit"> {unit}</span> : null}
    </button>
  )
}
