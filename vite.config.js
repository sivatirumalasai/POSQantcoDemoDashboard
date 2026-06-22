import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In Docker the backend is reachable as http://web:8000; locally it's localhost.
const BACKEND = process.env.BACKEND_ORIGIN || 'http://localhost:8000'
const WS_BACKEND = BACKEND.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: WS_BACKEND, ws: true, changeOrigin: true },
    },
  },
})
