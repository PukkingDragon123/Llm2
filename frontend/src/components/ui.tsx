import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errMsg } from '../api/client'

// ------------------------------------------------------------------ toasts
interface ToastItem { id: number; kind: 'ok' | 'err' | 'info'; text: string }
interface ToastApi { ok: (t: string) => void; err: (t: unknown) => void; info: (t: string) => void }
const ToastCtx = createContext<ToastApi>({ ok: () => {}, err: () => {}, info: () => {} })
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = ++seq.current
    setItems((s) => [...s.slice(-4), { id, kind, text }])
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === 'err' ? 9000 : 3500)
  }, [])
  const api = useMemo<ToastApi>(
    () => ({ ok: (t) => push('ok', t), info: (t) => push('info', t), err: (e) => push('err', errMsg(e)) }),
    [push],
  )
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ------------------------------------------------------------------ modal
export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ small widgets
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  )
}

export function Badge({ tone = 'gray', children, title }: { tone?: 'gray' | 'green' | 'red' | 'amber' | 'blue'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ({ draft: 'gray', quoted: 'blue', won: 'green', in_production: 'green', completed: 'green', lost: 'red' } as const)[status as 'draft'] || 'gray'
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>
}

export function Card({
  title,
  actions,
  children,
  className = '',
  id,
  flush,
  dataRow,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  flush?: boolean
  dataRow?: string
}) {
  return (
    <section className={`card ${className}`} id={id} data-row={dataRow}>
      {(title || actions) && (
        <header className="card-head">
          <h3>{title}</h3>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null
  if (error instanceof ApiError && error.isAiUnavailable) return <AiNotConfigured message={error.message} />
  return (
    <div className="alert err">
      <strong>Error:</strong> {errMsg(error)}
      {onRetry && (
        <button className="btn sm" onClick={onRetry} style={{ marginLeft: 12 }}>
          Retry
        </button>
      )}
    </div>
  )
}

export function AiNotConfigured({ message }: { message?: string }) {
  return (
    <div className="alert warn" role="alert" data-testid="ai-unavailable">
      <strong>Claude API key not configured.</strong> AI features need an Anthropic API key. Add one in{' '}
      <Link to="/settings">Settings → Claude API</Link>.
      {message && <div className="muted small">{message}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Field({ label, children, hint, wide }: { label: ReactNode; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/** Run an async action with busy/error state. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const run = useCallback(
    async (...a: A): Promise<R | undefined> => {
      setBusy(true)
      setError(null)
      try {
        return await fn(...a)
      } catch (e) {
        setError(e)
        return undefined
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  )
  return { run, busy, error, setError }
}

export function useConfirm() {
  return useCallback((msg: string) => window.confirm(msg), [])
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
  return Promise.resolve()
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="subtabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Sums({ items }: { items: { label: ReactNode; value: ReactNode; grand?: boolean }[] }) {
  return (
    <div className="sums">
      {items.map((it, i) => (
        <div key={i} className={`sum${it.grand ? ' grand' : ''}`}>
          <span className="sum-label">{it.label}</span>
          <span className="sum-val">{it.value}</span>
        </div>
      ))}
    </div>
  )
}
