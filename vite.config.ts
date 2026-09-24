import { defineConfig } from 'vite';

// Port pinned so the Playwright self-test never talks to a sibling game's dev server.
// Non-source folders are not watched: copying screenshots into docs/ while Vite watched it crashed
// the dev server on Windows (EBUSY file lock), and they never affect the running game anyway.
export default defineConfig({
  server: {
    port: 5317,
    strictPort: true,
    watch: {
      ignored: ['**/docs/**', '**/test-results/**', '**/screenshots/**', '**/blender_scripts/**', '**/tests/**', '**/tools/**', '**/dist/**'],
    },
  },
  preview: { port: 4317, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
