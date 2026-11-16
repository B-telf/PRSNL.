import { defineConfig } from 'vite';

// The page that native apps load in a web view. `npm run build:ios` then
// folds the result into a single self-contained HTML file.
export default defineConfig({
  root: 'embed',
  base: './',
  build: {
    outDir: '../embed-dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
