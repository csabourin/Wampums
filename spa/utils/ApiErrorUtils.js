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

/** Reasons api-core attaches to a write that never reached the server. */
const CODE_MESSAGE_KEYS = Object.freeze({
  online_required: 'family_operation_online_required',
  operation_unconfirmed: 'family_operation_unconfirmed',
});

/**
 * The translation key that explains a failed API call in the page's language.
 *
 * @param {Error|Object} error - Error thrown by the API layer (status, code, isNetworkError)
 * @param {string} [fallbackKey='error_occurred'] - Key used when nothing more specific applies
 * @returns {string} Translation key
 */
export function apiErrorMessageKey(error, fallbackKey = 'error_occurred') {
  const code = error?.code ?? error?.cause?.code;
  if (code && Object.hasOwn(CODE_MESSAGE_KEYS, code)) {
    return CODE_MESSAGE_KEYS[code];
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
