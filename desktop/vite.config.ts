import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Tauri compiles into src-tauri/target; watching it fails with EBUSY on Windows.
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
