# Prolog Titanium Estimator — frontend

Vite + React 19 + TypeScript SPA for the FastAPI backend in `../backend`.

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api -> http://localhost:8000
npm run build      # type-check + production build into dist/ (served by FastAPI at /)
npm run preview    # serve dist/ on :4173 with the same /api proxy
```

Start the backend with `cd ../backend && PROLOG_DATA_DIR=/tmp/prolog_dev uvicorn app.main:app --port 8000`.

Layout: `src/api` (types + fetch client + job polling), `src/editor.tsx` (project editor state: live
recalculation, save, issues, trace drawer), `src/components` (data grid, inputs, PDF/drawing viewers),
`src/tabs` (project workspace tabs), `src/pages` (dashboard, projects, suppliers, learning, settings).
