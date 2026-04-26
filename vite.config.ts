import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'app/static/src'),
  base: '/static/dist/',
  build: {
    outDir: path.resolve(__dirname, 'app/static/dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8100',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // .js included во время миграции (Tasks 14-26 портируют их в .ts; Task 30 удаляет старые).
    include: ['tests/frontend/**/*.test.{js,ts}'],
    root: __dirname,
  },
});
