import { defineConfig } from 'vite';

// Library build: `three` stays external so the host app supplies one copy.
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'loop' },
    rollupOptions: { external: [/^three($|\/)/] },
  },
});
