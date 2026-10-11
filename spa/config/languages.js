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

/**
 * Languages a unit may write its own form texts in. Wider than the web
 * interface: the mobile app and future interfaces read the same form formats,
 * and each of these has a bundle in lang/ to start the text from.
 */
export const FORM_CONTENT_LANGS = ['fr', 'en', 'it', 'uk', 'id'];
