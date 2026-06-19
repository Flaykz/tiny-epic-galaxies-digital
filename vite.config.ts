import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionStamp } from 'digital-boardgame-framework/vite';

export default defineConfig({
  // DBF_NO_ASSETS=1 builds WITHOUT copying public/ (the VASSAL-derived art), so a
  // public deploy doesn't redistribute copyrighted images. The app shows its
  // "run setup-assets" notice; local dev keeps the art.
  publicDir: process.env.DBF_NO_ASSETS ? false : 'public',
  // versionStamp injects __DBF_BUILD_ID__ and emits /version.json so the app can
  // detect when a newer build has been deployed and offer a reload.
  plugins: [react(), versionStamp() as any],
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the multiplayer GameServer during dev.
      '/api': 'http://localhost:8787',
    },
  },
});
