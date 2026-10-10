import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from 'node:module';
// Removed legacy plugin to reduce bundle size - targeting modern browsers only
// import legacy from '@vitejs/plugin-legacy';
import { visualizer } from "rollup-plugin-visualizer";
import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  SUPPORTED_LANGS,
} from './spa/config/languages.js';

/**
 * Copy translation bundles from the backend `lang/` directory into `dist/lang/`
 * so static client-side translation loading keeps working in production.
 *
 * Backend code still requires the source files under `lang/`, therefore this
 * plugin copies files instead of relocating them to `assets/`.
 */
function copyStaticLanguageBundlesPlugin() {
  return {
    name: "copy-static-language-bundles",
    closeBundle() {
      const projectRoot = process.cwd();
      const sourceDir = path.join(projectRoot, "lang");
      const targetDir = path.join(projectRoot, "dist", "lang");

      const languageFiles = fs
        .readdirSync(sourceDir)
        .filter((fileName) => fileName.endsWith(".json"));

      fs.mkdirSync(targetDir, { recursive: true });

      for (const fileName of languageFiles) {
        fs.copyFileSync(
          path.join(sourceDir, fileName),
          path.join(targetDir, fileName),
        );
      }
    },
  };
}

function copyStaticCssPlugin() {
  return {
    name: "copy-static-css",
    closeBundle() {
      const projectRoot = process.cwd();
      const sourceDir = path.join(projectRoot, "css");
      const targetDir = path.join(projectRoot, "dist", "css");

      if (!fs.existsSync(sourceDir)) return;

      const cssFiles = fs
        .readdirSync(sourceDir)
        .filter((fileName) => fileName.endsWith(".css"));

      fs.mkdirSync(targetDir, { recursive: true });

      for (const fileName of cssFiles) {
        fs.copyFileSync(
          path.join(sourceDir, fileName),
          path.join(targetDir, fileName),
        );
      }
    },
  };
}

// Shared with the server (CommonJS), which must compute the same versions.
// Vite bundles this config, so resolve it from the project, not this file.
const { contentVersion } = createRequire(path.join(process.cwd(), 'package.json'))('./utils/asset-version.js');

/**
 * Start downloading the visitor's translations from index.html, in parallel
 * with the app's JavaScript, instead of after it has loaded and run.
 *
 * Each bundle is requested as `/lang/<code>.json?v=<content version>`; the
 * server answers a matching version as immutable (see middleware/global.js),
 * so a returning visitor reads it from cache, and a new build -- whose bundles
 * have new versions -- is never paired with the previous build's keys.
 * spa/app.js reuses the request started here (`window.__wampumsTranslations`)
 * and the versions (`window.__wampumsLangVersions`) for language switches.
 */
function earlyTranslationsPlugin() {
  const versions = Object.fromEntries(
    SUPPORTED_LANGS.map((code) => [
      code,
      contentVersion(fs.readFileSync(path.join(process.cwd(), 'lang', `${code}.json`))),
    ]),
  );

  const script = `(function () {
  try {
    var versions = ${JSON.stringify(versions)};
    window.__wampumsLangVersions = versions;
    var lang = localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)});
    if (!Object.prototype.hasOwnProperty.call(versions, lang)) {
      lang = ${JSON.stringify(DEFAULT_LANG)};
    }
    var url = "/lang/" + lang + ".json?v=" + versions[lang];
    var response = fetch(url, { priority: "high" }).then(function (res) {
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      return res.json();
    });
    response.catch(function () {});
    window.__wampumsTranslations = { lang: lang, response: response };
  } catch (error) {
    window.__wampumsTranslations = null;
  }
})();`;

  return {
    name: 'early-translations',
    transformIndexHtml() {
      return [{ tag: 'script', children: script, injectTo: 'head-prepend' }];
    },
  };
}

/**
 * Preload the Font Awesome solid face. It is only discovered once the first
 * icon renders, after the app's JavaScript has run, and Font Awesome hides
 * icons until the font arrives (font-display: block).
 */
function preloadIconFontPlugin() {
  return {
    name: 'preload-icon-font',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const font = Object.keys(ctx.bundle || {}).find((fileName) =>
        /(^|\/)fa-solid-900-[^/]+\.woff2$/.test(fileName),
      );
      if (!font) {
        return [];
      }
      return [{
        tag: 'link',
        attrs: { rel: 'preload', href: `/${font}`, as: 'font', type: 'font/woff2', crossorigin: '' },
        injectTo: 'head',
      }];
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "assets",

  build: {
    outDir: "dist",
    emptyOutDir: true,

    rollupOptions: {
      input: {
        main: "./index.html",
      },
      output: {
        manualChunks: {
          // Core application
          core: ["./spa/app.js", "./spa/router.js", "./spa/functions.js"],

          // API and data management
          api: ["./spa/ajax-functions.js", "./spa/indexedDB.js"],

          // Admin pages - lazy loaded
          admin: [
            "./spa/admin.js",
            "./spa/manage_participants.js",
            "./spa/manage_groups.js",
            "./spa/manage_users_participants.js",
          ],

          // Staff functionality - lazy loaded
          staff: [
            "./spa/attendance.js",
            "./spa/manage_points.js",
            "./spa/manage_honors.js",
            "./spa/modules/meetings/MeetingPrep.js",
          ],

          // Reports - lazy loaded
          reports: [
            "./spa/reports.js",
            "./spa/mailing_list.js",
            "./spa/calendars.js",
          ],

          // Forms - lazy loaded
          forms: [
            "./spa/formulaire_inscription.js",
            "./spa/badge_form.js",
            "./spa/dynamicFormHandler.js",
          ],

          // Parent portal - lazy loaded
          parent: ["./spa/parent_dashboard.js", "./spa/parent_contact_list.js"],

          // Authentication
          auth: [
            "./spa/login.js",
            "./spa/register.js",
            "./spa/reset_password.js",
          ],
        },

        // Optimize chunk sizes
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },

    // Optimize build
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ["console.log", "console.info", "console.debug"],
      },
    },

    target: "es2020",
    sourcemap: process.env.NODE_ENV === "development",

    // Chunk size warnings
    chunkSizeWarningLimit: 500,
  },

  server: {
    port: 5173,
    watch: {
      ignored: ["**/logs/**", "**/*.log"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: false,
      },
      "/public": {
        target: "http://127.0.0.1:5000",
        changeOrigin: false,
      },
      // Live sync and the WhatsApp QR feed (Socket.IO, served by the API)
      "/socket.io": {
        target: "http://127.0.0.1:5000",
        changeOrigin: false,
        ws: true,
      },
    },
  },

  plugins: [
    earlyTranslationsPlugin(),
    preloadIconFontPlugin(),
    copyStaticLanguageBundlesPlugin(),
    copyStaticCssPlugin(),

    // PWA Support
    VitePWA({
      strategies: "injectManifest",
      registerType: "prompt",
      // Register from a deferred script: a plain one blocks HTML parsing.
      injectRegister: 'script-defer',
      srcDir: ".",
      filename: "src-sw.js",

      manifest: {
        name: "Wampums Scout Management",
        short_name: "Wampums",
        description: "Scout management application",
        theme_color: "#4c65ae",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          {
            src: "/images/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/images/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },

      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
        globIgnores: [
          "**/node_modules/**",
          "service-worker.js",
          "**/index.html", // Exclude index.html to prevent stale asset references
          // Every visitor installs the precache right after their first load, in
          // competition with the screen they opened. Keep it to the app shell:
          // badge art and unit logos are cached by the image route when shown;
          // the translations by their own route, per build version, as the app
          // loads them (precaching all of them also answered /lang/* from the
          // install-time build, ahead of that route); css/ holds unhashed copies
          // of stylesheets the app now loads from assets/.
          'images/**',
          'lang/**',
          'css/**',
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),

    // Legacy browser support removed - targeting modern browsers (ES2020+) for better performance
    // This reduces bundle size significantly and improves load times

    // Bundle analyzer (only in analysis mode)
    process.env.ANALYZE &&
    visualizer({
      open: true,
      filename: "dist/stats.html",
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),

  // Optimize dependencies
  optimizeDeps: {
    include: [],
  },

  // CSS optimization
  css: {
    devSourcemap: true,
  },
});
