import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Zipp Zap',
          short_name: 'Zipp Zap',
          description: 'Interactive video studio, slideshow builder, and collaborative portal for team surprises and rewards.',
          theme_color: '#4f46e5',
          background_color: '#0f172a',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // The ffmpeg/ONNX engine files are large (20-32MB each) and only ever fetched
          // on-demand when a user actually renders/transcribes/synthesizes speech - keep
          // them OUT of the initial install precache (which would otherwise force every
          // visitor to download 100MB+ up front) and instead cache them the first time
          // they're actually requested, via the runtime rule below.
          globIgnores: ['**/ffmpeg/**', '**/ffmpeg-mt/**', '**/*.wasm'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/ffmpeg/') ||
                url.pathname.startsWith('/ffmpeg-mt/') ||
                url.pathname.startsWith('/fonts/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'zippzap-engine-assets',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Whisper/Piper model weights, fetched from Hugging Face's model CDN.
              urlPattern: ({ url }) => /huggingface\.co|hf\.co/i.test(url.hostname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'zippzap-ml-models',
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 180 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Built-in background music tracks.
              urlPattern: ({ url }) => /soundhelix\.com/i.test(url.hostname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'zippzap-soundtracks',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
