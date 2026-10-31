import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import type { Issue } from '../api/types'
import { useEditor } from '../editor'
import { ErrorBox, Modal, Spinner, useToast } from './ui'

export function IssueList({ issues, onPick }: { issues: Pick<Issue, 'severity' | 'path' | 'message' | 'question'>[]; onPick?: (path: string) => void }) {
  return (
    <ul className="issue-list">
      {issues.map((i, n) => (
        <li key={n} className={`issue ${i.severity}`}>
          <button className="issue-btn" onClick={() => onPick?.(i.path)} data-testid="issue-item">
            <span className={`sev ${i.severity}`}>{i.severity}</span>
            <span className="issue-msg">{i.message}</span>
            <code className="issue-path">{i.path}</code>
          </button>
          {i.question && <div className="issue-q">Question: {i.question}</div>}
        </li>
      ))}
    </ul>
  )
}

export function IssueRevisionModal({ onClose }: { onClose: () => void }) {
  const ed = useEditor()
  const nav = useNavigate()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const blocking = ed.issues.filter((i) => i.severity === 'missing' || i.severity === 'error')
  async function go() {
    setBusy(true)
    setErr(null)
    try {
      if (ed.dirty && !(await ed.save())) throw new Error('Could not save the project first')
      const r = await api.post<{ rev_no: number; quotation_no: string }>(`/api/projects/${ed.id}/revisions`, { note })
      toast.ok(`Issued revision ${r.rev_no} (${r.quotation_no})`)
      await ed.reload(true)
      onClose()
      nav(ed.tabPath('revisions'))
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }
  const conflict = err instanceof ApiError && err.status === 409 ? err : null
  return (
    <Modal
      title="Issue quotation revision"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={go} disabled={busy} data-testid="issue-confirm">{busy ? 'Issuing…' : 'Issue revision'}</button>
        </>
      }
    >
      <p className="muted">
        Issuing freezes the current estimate and quotation text as a numbered revision and generates the quotation (xlsx + pdf) and the internal costing files.
        {ed.dirty && <strong> Unsaved changes will be saved first.</strong>}
      </p>
      {blocking.length > 0 && !conflict && (
        <div className="alert warn">{blocking.length} missing input(s) / error(s) block issuing — the server will refuse until they are resolved.</div>
      )}
      <label className="field wide"><span className="field-label">Revision note</span>
        <textarea className="inp" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this revision?" autoFocus />
      </label>
      {busy && <Spinner label="Generating quotation and costing files (LibreOffice)… a few seconds" />}
      {conflict ? (
        <div className="alert err" data-testid="issue-409">
          <strong>{conflict.message}</strong>
          <IssueList issues={conflict.issues || []} onPick={(p) => { onClose(); ed.focus(p) }} />
        </div>
      ) : (
        <ErrorBox error={err} />
      )}
    </Modal>
  )
}
