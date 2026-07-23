import { CONFIG } from '../config.js';

/**
 * Format a monetary amount using the active UI locale and configured currency.
 *
 * @param {number|string|null} amount - Numeric amount
 * @param {string} lang - BCP 47 locale/language
 * @param {string} currency - ISO 4217 currency code
 * @returns {string} Localized currency
 */
export function formatCurrency(
  amount,
  lang = CONFIG.DEFAULT_LANG,
  currency = CONFIG.DEFAULT_CURRENCY,
) {
  const numericAmount = Number(amount);
  return new Intl.NumberFormat(lang || CONFIG.DEFAULT_LANG, {
    style: 'currency',
    currency: currency || CONFIG.DEFAULT_CURRENCY,
  }).format(Number.isFinite(numericAmount) ? numericAmount : 0);
}
