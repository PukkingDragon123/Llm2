import type { Num } from '../api/types'

export function fmt(v: number | null | undefined, dp = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
/** Number with up to `max` decimals (no trailing zeros). */
export function fmtN(v: number | null | undefined, max = 4): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: max })
}
export function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v == null || Number.isNaN(v)) return '—'
  return (v * 100).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) + '%'
}
export function fmtDate(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z')
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)$/

/** Text from a numeric-input value. */
export function numToText(v: Num | undefined): string {
  if (v == null) return ''
  return String(v)
}
/** Parse text from an input: blank -> null, plain number -> number, anything else -> kept as string expression. */
export function parseNumText(t: string): Num {
  const s = t.trim()
  if (s === '') return null
  if (PLAIN.test(s)) return Number(s)
  return t
}
export function sameNum(a: Num | undefined, b: Num | undefined): boolean {
  return (a ?? null) === (b ?? null)
}

/** Safe evaluation of simple arithmetic input for display only (never sent to the API). */
export function evalNum(v: Num | undefined): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const s = v.replace(/,/g, '').trim()
  if (PLAIN.test(s)) return Number(s)
  if (!/^[\d+\-*/().\s]+$/.test(s)) return null
  try {
    const r = Function(`"use strict"; return (${s})`)() as unknown
    return typeof r === 'number' && Number.isFinite(r) ? r : null
  } catch {
    return null
  }
}

export function uid(prefix = 'x'): string {
  return prefix + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5)
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || uid('s')
}

export function download(name: string, text: string, mime = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: mime }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const STATUSES = ['draft', 'quoted', 'won', 'lost', 'in_production', 'completed'] as const
export const statusLabel = (s: string) => s.replace(/_/g, ' ')
