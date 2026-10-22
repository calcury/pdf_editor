import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Actions sets this to /<repository>/ for project pages.
  // Set BASE_PATH=/ when deploying to a user/org root domain.
  base: process.env.BASE_PATH || '/',
});
