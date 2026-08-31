import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionStamp } from 'digital-boardgame-framework/vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this as a project page (github.com/Flaykz/tiny-epic-
  // galaxies-digital → flaykz.github.io/tiny-epic-galaxies-digital/), so built
  // asset URLs need that subpath prefix. Dev keeps serving from root.
  base: command === 'build' ? '/tiny-epic-galaxies-digital/' : '/',
  // DBF_NO_ASSETS=1 builds WITHOUT copying public/ (the VASSAL-derived art), so a
  // public deploy doesn't redistribute copyrighted images. The app shows its
  // "run setup-assets" notice; local dev keeps the art.
  publicDir: process.env.DBF_NO_ASSETS ? false : 'public',
  // versionStamp injects __DBF_BUILD_ID__ and emits /version.json so the app can
  // detect when a newer build has been deployed and offer a reload.
  plugins: [react(), versionStamp() as any],
  server: {
    // Honor a PORT assigned by the tooling (e.g. preview auto-port); else 5173.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // Forward API calls to the multiplayer GameServer during dev.
      '/api': 'http://localhost:8787',
    },
  },
}));
