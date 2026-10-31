import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { api } from './api/client'
import type { AiStatus } from './api/types'
import { Dashboard } from './pages/Dashboard'
import { Learning } from './pages/Learning'
import { Projects } from './pages/Projects'
import { Settings } from './pages/Settings'
import { Suppliers } from './pages/Suppliers'
import { Workspace } from './pages/Workspace'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/projects', label: 'Projects', icon: '▤' },
  { to: '/suppliers', label: 'Suppliers & prices', icon: '⛁' },
  { to: '/learning', label: 'History & learning', icon: '↗' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

function Shell() {
  const [ai, setAi] = useState<AiStatus | null>(null)
  useEffect(() => {
    api.get<{ ai: AiStatus }>('/api/health').then((h) => setAi(h.ai)).catch(() => setAi(null))
  }, [])
  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="Prolog Titanium Estimator">
          <img src="/logo.png" alt="Prolog Titanium" />
          <span>
            <strong>Prolog Titanium</strong>
            <small>Estimator</small>
          </span>
        </NavLink>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>
              <span className="ico" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <NavLink to="/settings" className={`ai-pill ${ai?.configured ? 'ok' : 'off'}`} title={ai?.configured ? `Model ${ai.model}` : 'No API key configured'}>
            <span className="dot" />
            Claude {ai ? (ai.configured ? 'connected' : 'not configured') : '…'}
          </NavLink>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id/:tab?" element={<Workspace />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="learning" element={<Learning />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
