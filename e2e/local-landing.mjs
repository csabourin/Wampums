/** Public-host pages stay on the disposable API during browser checks. */
export const LANDING_ORIGIN = 'https://wampums.app';
const LOCAL_API = process.env.LANDING_API_URL || 'http://127.0.0.1:5000';
const CONNECTION_RESET_RETRIES = 2;

/**
 * Fetch a public-site resource locally, tolerating a bounded connection reset.
 * Playwright retries ECONNRESET only; HTTP failures and assertions still fail.
 */
export function fetchLocalLanding(request, resourceUrl, localApi = LOCAL_API) {
  const url = new URL(resourceUrl);
  return request.get(`${localApi}${url.pathname}${url.search}`, {
    headers: { host: 'wampums.app' },
    maxRetries: CONNECTION_RESET_RETRIES,
  });
}
