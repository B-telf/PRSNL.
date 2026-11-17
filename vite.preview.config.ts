import { defineConfig } from 'vite';

// The motion-pass preview page (`npm run dev`, then /preview/).
export default defineConfig({
  root: 'preview',
  base: './',
  build: {
    outDir: '../preview-dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
