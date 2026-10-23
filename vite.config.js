import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Actions sets this to /<repository>/ for project pages.
  // Set BASE_PATH=/ when deploying to a user/org root domain.
  base: process.env.BASE_PATH || '/',
  build: { target: 'esnext' },
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
    // Ghostscript's Emscripten factory uses a CommonJS export wrapper. Keep it out of
    // Vite's dependency prebundle so browser workers receive the real module, not a stub.
    exclude: ['@jspawn/ghostscript-wasm/gs.js'],
  },
});
