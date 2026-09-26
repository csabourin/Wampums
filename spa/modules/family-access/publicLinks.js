/**
 * Requests made by the pages that emailed links open.
 *
 * These pages run without a session, so they use `fetch` against the public
 * endpoints rather than the authenticated API client, which would redirect to
 * the login page on a 401 that these pages can legitimately receive.
 *
 * URLs are built with `URL`, never by concatenation. `getApiUrl` may return a
 * base that already has a query string, and appending `?token=…` to that is how
 * the reactivation page once sent its token inside another parameter's value.
 *
 * @module spa/modules/family-access/publicLinks
 */

import { getApiUrl } from '../../config.js';
import { debugError } from '../../utils/DebugUtils.js';

/**
 * Ask what a link is, without acting on it.
 *
 * @param {string} path - Describe endpoint, e.g. `/api/v1/public/family-links/describe`
 * @param {string} token - Token from the page's own URL
 * @returns {Promise<Object>} The link description; `{ state: 'invalid' }` on any failure
 */
export async function describeLink(path, token) {
  try {
    const url = new URL(getApiUrl(path));
    url.searchParams.set('token', token);
    const response = await fetch(url);
    const body = await response.json();
    return body?.data || { state: 'invalid' };
  } catch (error) {
    debugError('Failed to describe link:', error);
    return { state: 'invalid' };
  }
}

/**
 * Act on a link.
 *
 * Never throws: a page that is showing a form needs an answer it can render,
 * and "the network failed" is one.
 *
 * @param {string} path - Action endpoint
 * @param {Object} payload - Body, including the token
 * @returns {Promise<{ok: boolean, status: number, data: Object, message: string|null}>}
 *   The outcome
 */
export async function postLink(path, payload) {
  try {
    const response = await fetch(getApiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let body = {};
    try {
      body = await response.json();
    } catch (_parseError) {
      body = {};
    }
    return {
      ok: response.ok,
      status: response.status,
      data: body?.data || {},
      message: body?.message || null,
    };
  } catch (error) {
    debugError('Failed to submit link action:', error);
    return { ok: false, status: 0, data: {}, message: null };
  }
}
