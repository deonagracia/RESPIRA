import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false
  },
  preview: {
    port: 4173
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
