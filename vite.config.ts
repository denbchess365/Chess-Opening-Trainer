import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` keeps every URL relative so the app works under
// https://<user>.github.io/<repo>/ without knowing the repo name.
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Repertoire Trainer',
        short_name: 'Repertoire',
        description: 'Offline chess opening repertoire builder and spaced-repetition trainer',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#161512',
        theme_color: '#161512',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
