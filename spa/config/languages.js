/**
 * Interface languages. Kept free of browser globals so the build
 * (vite.config.mjs) can read the same values the SPA uses: the build starts
 * the translation download from index.html, before the app's code arrives.
 *
 * The same lists live in config/interface_languages.json for the server; a
 * test keeps the two in step.
 */

/** Language used when the visitor has not chosen one */
export const DEFAULT_LANG = 'fr';

/**
 * Core languages: always offered, and kept at parity key for key
 * (npm run lint:i18n-parity). A page in one of them never shows another.
 */
export const SUPPORTED_LANGS = ['en', 'fr'];

/**
 * Optional languages a unit may offer. Their bundles are partial: a missing
 * key falls back to the unit's fallback language (French or English).
 */
export const OPTIONAL_LANGS = ['uk', 'it', 'id'];

/** Every language the interface can be shown in */
export const INTERFACE_LANGS = ['fr', 'en', ...OPTIONAL_LANGS];

/** Fallback for optional languages when the unit has not chosen one */
export const DEFAULT_FALLBACK_LANG = 'en';

/** organization_settings key holding a unit's `{ enabled, fallback }` */
export const INTERFACE_LANGUAGES_SETTING_KEY = 'interface_languages';

/** localStorage key holding the visitor's chosen language */
export const LANG_STORAGE_KEY = 'lang';

/** localStorage key remembering the unit's fallback, for the next start */
export const FALLBACK_LANG_STORAGE_KEY = 'lang_fallback';

/**
 * Languages a unit may write its own form texts in: every interface
 * language. The form builder offers those the unit uses.
 */
export const FORM_CONTENT_LANGS = INTERFACE_LANGS;
