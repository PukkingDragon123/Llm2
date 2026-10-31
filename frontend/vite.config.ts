import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: /api is proxied to the FastAPI backend. Production: `npm run build` -> dist/, served by FastAPI.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:8000' } },
  build: { chunkSizeWarningLimit: 900 },
})
