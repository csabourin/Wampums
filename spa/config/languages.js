/**
 * Interface languages. Kept free of browser globals so the build
 * (vite.config.mjs) can read the same values the SPA uses: the build starts
 * the translation download from index.html, before the app's code arrives.
 */

/** Language used when the visitor has not chosen one */
export const DEFAULT_LANG = 'fr';

/** Languages the web app offers */
export const SUPPORTED_LANGS = ['en', 'fr'];

/** localStorage key holding the visitor's chosen language */
export const LANG_STORAGE_KEY = 'lang';
