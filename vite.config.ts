import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionStamp } from 'digital-boardgame-framework/vite';

export default defineConfig({
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
