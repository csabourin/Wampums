import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import legacy from '@vitejs/plugin-legacy';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  root: '.',
  publicDir: 'images',

  build: {
    outDir: 'dist',
    emptyOutDir: true,

    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks: {
          // Core application
          'core': [
            './spa/app.js',
            './spa/router.js',
            './spa/functions.js'
          ],

          // API and data management
          'api': [
            './spa/ajax-functions.js',
            './spa/indexedDB.js'
          ],

          // Admin pages - lazy loaded
          'admin': [
            './spa/admin.js',
            './spa/manage_participants.js',
            './spa/manage_groups.js',
            './spa/manage_users_participants.js'
          ],

          // Staff functionality - lazy loaded
          'staff': [
            './spa/attendance.js',
            './spa/manage_points.js',
            './spa/manage_honors.js',
            './spa/preparation_reunions.js'
          ],

          // Reports - lazy loaded
          'reports': [
            './spa/reports.js',
            './spa/mailing_list.js',
            './spa/calendars.js'
          ],

          // Forms - lazy loaded
          'forms': [
            './spa/formulaire_inscription.js',
            './spa/fiche_sante.js',
            './spa/acceptation_risque.js',
            './spa/badge_form.js',
            './spa/dynamicFormHandler.js'
          ],

          // Parent portal - lazy loaded
          'parent': [
            './spa/parent_dashboard.js',
            './spa/parent_contact_list.js'
          ],

          // Authentication
          'auth': [
            './spa/login.js',
            './spa/register.js',
            './spa/reset_password.js'
          ]
        },

        // Optimize chunk sizes
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },

    // Optimize build
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      }
    },

    target: 'es2020',
    sourcemap: process.env.NODE_ENV === 'development',

    // Chunk size warnings
    chunkSizeWarningLimit: 500
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },

  plugins: [
    // PWA Support
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['images/**/*', 'favicon.ico'],

      manifest: {
        name: 'Wampums Scout Management',
        short_name: 'Wampums',
        description: 'Scout management application',
        theme_color: '#4c65ae',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/images/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/images/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5 // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      }
    }),

    // Legacy browser support (optional)
    legacy({
      targets: ['defaults', 'not IE 11']
    }),

    // Bundle analyzer (only in analysis mode)
    process.env.ANALYZE && visualizer({
      open: true,
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true
    })
  ],

  // Optimize dependencies
  optimizeDeps: {
    include: []
  },

  // CSS optimization
  css: {
    devSourcemap: true
  }
});
