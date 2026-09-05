import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { versionStamp } from 'digital-boardgame-framework/vite';

const APP_ICONS_DIR = fileURLToPath(new URL('./app-icons', import.meta.url));
const APP_ICON_FILES = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.svg', 'favicon.ico'];

/**
 * Emits the app's own icons (app-icons/ — an original SVG-derived design, never
 * the copyrighted VASSAL art) straight into the build output, regardless of
 * DBF_NO_ASSETS/publicDir (see the comment on `publicDir` below — that flag
 * blanket-disables publicDir, which would also swallow these otherwise-safe
 * files). Uses `generateBundle`, not a postbuild script, so the files exist in
 * dist/ *before* vite-plugin-pwa's own build step scans it to build the offline
 * precache list — a copy step run after `vite build` finishes would miss that
 * window and leave the icons uncached for offline use.
 */
function copyAppIcons(): Plugin {
  return {
    name: 'copy-app-icons',
    generateBundle() {
      if (!existsSync(APP_ICONS_DIR)) return;
      for (const file of APP_ICON_FILES) {
        const full = `${APP_ICONS_DIR}/${file}`;
        if (!existsSync(full)) continue;
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(full) });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves this as a project page (github.com/Flaykz/tiny-epic-
  // galaxies-digital → flaykz.github.io/tiny-epic-galaxies-digital/), so built
  // asset URLs need that subpath prefix. Only `vite dev` (mode 'development')
  // should stay at root — `vite preview` reports the same command ('serve') as
  // `vite dev`, but defaults to mode 'production' just like `vite build`, and it
  // serves the already-built dist/index.html (which has the subpath baked into
  // its asset URLs) — checking `command === 'build'` here would make preview's
  // own static server disagree with that baked-in base and 404 everything.
  base: mode === 'production' ? '/tiny-epic-galaxies-digital/' : '/',
  // DBF_NO_ASSETS=1 builds WITHOUT copying public/ (the VASSAL-derived art), so a
  // public deploy doesn't redistribute copyrighted images. The app shows its
  // "run setup-assets" notice; local dev keeps the art.
  publicDir: process.env.DBF_NO_ASSETS ? false : 'public',
  plugins: [
    react(),
    // versionStamp injects __DBF_BUILD_ID__ and emits /version.json so the app
    // can detect when a newer build has been deployed and offer a reload.
    versionStamp() as any,
    copyAppIcons(),
    // Installable + offline: local hotseat and solo-vs-Rogue-Galaxy run 100%
    // client-side, so once the app shell is cached it keeps working with no
    // network at all. registerType 'autoUpdate' lets the service worker refresh
    // its cache silently in the background — the app already has its own
    // user-facing "new version — Reload" prompt (see <UpdateBanner> in App.tsx),
    // so a second, separate workbox update prompt would just be redundant/
    // conflicting with that.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'Tiny Epic Galaxies',
        short_name: 'Tiny Epic Galaxies',
        description: 'A digital port of Tiny Epic Galaxies — local hotseat and solo play work fully offline once installed.',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        display: 'standalone',
        // Relative, not base-prefixed — resolves correctly against wherever the
        // manifest itself ends up served, on GitHub Pages' subpath or otherwise.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app shell (JS/CSS/HTML + our icons — copyAppIcons()
        // above runs early enough that they're already in dist/ by the time this
        // scans it) so local/solo play works with zero network after first load.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    // Honor a PORT assigned by the tooling (e.g. preview auto-port); else 5173.
    port: Number(process.env.PORT) || 5173,
    // Bind on 0.0.0.0, not just localhost, so another device on the same LAN
    // (phone/tablet for real-device testing) can reach it via the machine's
    // local IP — `npm run dev` prints that URL on startup.
    host: true,
  },
}));
