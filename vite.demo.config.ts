import { defineConfig } from 'vite';

// Standalone playground build (bundles three).
export default defineConfig({
  base: './',
  build: { outDir: 'demo-dist' },
});
