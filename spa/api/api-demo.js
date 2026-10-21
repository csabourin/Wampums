/**
 * The demo unit (demo.wampums.app): opening it as a parent or as a leader.
 *
 * @module spa/api/api-demo
 */
import { CONFIG } from '../config.js';
import { getCurrentOrganizationId } from './api-helpers.js';

/**
 * Sign in to the demo unit's read-only account for one view. Public, like the
 * password sign-in: there is no session yet, so it does not go through API.
 *
 * @param {'parent'|'leader'} view - Which side of the app to show
 * @returns {Promise<Object>} The sign-in response, or `{ success: false, status, message }`
 */
export async function startDemoSession(view) {
  const url = new URL('/api/v1/auth/demo-login', CONFIG.API_BASE_URL);
  const organizationId = getCurrentOrganizationId();
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(organizationId ? { 'x-organization-id': String(organizationId) } : {}),
    },
    body: JSON.stringify({ view }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { success: false, status: response.status, message: data?.message };
  }
  return data;
}
