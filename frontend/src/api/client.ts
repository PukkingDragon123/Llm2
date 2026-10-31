// Small fetch client with FastAPI error handling and job polling.
import type { Job } from './types'

export class ApiError extends Error {
  status: number
  code?: string
  body: unknown
  constructor(message: string, status: number, body?: unknown, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.code = code
  }
  get isAiUnavailable() {
    return this.code === 'ai_unavailable'
  }
  /** Issues attached to a 409 "missing inputs" response. */
  get issues(): { severity: string; path: string; message: string; question: string }[] | null {
    const b = this.body as { detail?: { issues?: never[] } } | undefined
    return (b?.detail && typeof b.detail === 'object' && !Array.isArray(b.detail) && b.detail.issues) || null
  }
}

function detailText(detail: unknown): string {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const loc = Array.isArray((d as { loc?: unknown[] }).loc) ? (d as { loc: unknown[] }).loc.slice(1).join('.') : ''
          return `${loc ? loc + ': ' : ''}${(d as { msg: string }).msg}`
        }
        return JSON.stringify(d)
      })
      .join('; ')
  }
  if (typeof detail === 'object') {
    const o = detail as { message?: string }
    if (o.message) return o.message
    return JSON.stringify(detail)
  }
  return String(detail)
}

async function parse(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('json')) return res.json().catch(() => null)
  return res.text()
}

export async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(url, { method, headers, body: payload, ...init })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Cannot reach the server. Is the backend running?', 0)
  }
  const data = await parse(res)
  if (!res.ok) {
    const d = data as { detail?: unknown; code?: string } | string | null
    const detail = typeof d === 'object' && d ? d.detail : d
    const code = typeof d === 'object' && d ? d.code : undefined
    throw new ApiError(detailText(detail) || `${res.status} ${res.statusText}`, res.status, data, code)
  }
  return data as T
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>('GET', url, undefined, init),
  post: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>('POST', url, body ?? {}, init),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, file: File, extra?: Record<string, string>) => {
    const fd = new FormData()
    fd.append('file', file)
    for (const [k, v] of Object.entries(extra || {})) fd.append(k, v)
    return request<T>('POST', url, fd)
  },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll /api/jobs/{id} until done|error. */
export async function pollJob<T>(jobId: string, opts?: { interval?: number; signal?: AbortSignal }): Promise<T> {
  const interval = opts?.interval ?? 1000
  for (;;) {
    if (opts?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const j = await api.get<Job<T>>(`/api/jobs/${jobId}`)
    if (j.status === 'done') return j.result as T
    if (j.status === 'error') throw new ApiError(j.error || 'Job failed', 500, j, j.code)
    await sleep(interval)
  }
}

/** Start a job endpoint (returns {job_id}) and wait for its result. */
export async function runJob<T>(start: Promise<{ job_id: string }>): Promise<T> {
  const { job_id } = await start
  return pollJob<T>(job_id)
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}
