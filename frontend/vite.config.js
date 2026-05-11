import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_KEYBOARD_LAYOUT': JSON.stringify(process.env.KEYBOARD_LAYOUT || 'QWERTY'),
    'import.meta.env.VITE_SHUFFLE': JSON.stringify(process.env.SHUFFLE || 'False'),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'localhost',
      process.env.ALLOWED_HOST,
    ].filter(Boolean),
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
