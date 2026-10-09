import { translate } from '../app.js';

/**
 * HTTP statuses that have their own explanation for the person on screen.
 * The server's own `message` is English, written for developers, so it is
 * never shown as is.
 */
const STATUS_MESSAGE_KEYS = Object.freeze({
  400: 'api_error_invalid',
  403: 'api_error_forbidden',
  404: 'api_error_not_found',
  409: 'api_error_conflict',
  413: 'api_error_too_large',
});

/**
 * Machine-readable reasons that already have their own explanation: those
 * api-core attaches to a write that never reached the server, and those the
 * server sends (`code`, or `error.code` from the AI endpoints).
 */
const CODE_MESSAGE_KEYS = Object.freeze({
  online_required: 'family_operation_online_required',
  operation_unconfirmed: 'family_operation_unconfirmed',
  AI_BUDGET_EXCEEDED: 'ai_budget_exceeded',
});

/** api-core prefixes the server's message when it gives up on a request. */
const API_CORE_PREFIX = 'API request failed: ';

/** A server message that is itself a translation key, e.g. `invalid_or_expired_token`. */
const TRANSLATION_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-zA-Z0-9_]+)*$/;

/** Server keys that say less than the screen's own fallback. */
const GENERIC_SERVER_KEYS = new Set(['internal_server_error']);

/**
 * The server's message, when it is a translation key this page knows.
 *
 * @param {Error|Object} error - Error thrown by the API layer
 * @returns {string|null} Translation key, or null
 */
function serverMessageKey(error) {
  const raw = String(error?.cause?.message ?? error?.message ?? '');
  const message = raw.startsWith(API_CORE_PREFIX) ? raw.slice(API_CORE_PREFIX.length) : raw;
  if (!TRANSLATION_KEY_PATTERN.test(message) || GENERIC_SERVER_KEYS.has(message)) {
    return null;
  }
  // translate() answers with the key itself when it has no translation.
  return translate(message) === message ? null : message;
}

/**
 * The translation key that explains a failed API call in the page's language.
 *
 * @param {Error|Object} error - Error thrown by the API layer (status, code, isNetworkError)
 * @param {string} [fallbackKey='error_occurred'] - Key used when nothing more specific applies
 * @returns {string} Translation key
 */
export function apiErrorMessageKey(error, fallbackKey = 'error_occurred') {
  // A write refused while consulting an archived year is a 403 too, but it
  // says why; keep that rather than "no permission".
  if (error?.isArchiveReadOnly === true || error?.cause?.isArchiveReadOnly === true) {
    return 'scout_year_read_only';
  }
  const code = error?.code ?? error?.cause?.code ?? error?.error?.code;
  if (code && Object.hasOwn(CODE_MESSAGE_KEYS, code)) {
    return CODE_MESSAGE_KEYS[code];
  }
  const serverKey = serverMessageKey(error);
  if (serverKey) {
    return serverKey;
  }
  if (error?.isNetworkError === true) {
    return 'api_error_network';
  }
  const status = Number(error?.status ?? error?.cause?.status);
  if (Object.hasOwn(STATUS_MESSAGE_KEYS, status)) {
    return STATUS_MESSAGE_KEYS[status];
  }
  return fallbackKey;
}

/**
 * A failed API call, explained in the page's language.
 *
 * @param {Error|Object} error - Error thrown by the API layer
 * @param {string} [fallbackKey='error_occurred'] - Key used when nothing more specific applies
 * @returns {string} Translated message
 */
export function apiErrorMessage(error, fallbackKey = 'error_occurred') {
  return translate(apiErrorMessageKey(error, fallbackKey));
}
