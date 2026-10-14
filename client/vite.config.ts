import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Forward API calls to the ASP.NET Core backend during development.
    proxy: {
      '/api': 'http://localhost:5080',
    },
  },
  build: {
    // `npm run build` drops the bundle where ASP.NET Core serves static files.
    outDir: '../server/wwwroot',
    emptyOutDir: true,
  },
})
