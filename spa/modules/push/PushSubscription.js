/**
 * Browser push subscription: subscribe this browser with the server's VAPID
 * key and register the subscription for the signed-in member.
 *
 * @module modules/push/PushSubscription
 */

import { makeApiRequest } from '../../api/api-core.js';
import { CONFIG } from '../../config.js';
import { debugLog, debugError, debugWarn } from '../../utils/DebugUtils.js';
import { urlBase64ToUint8Array } from '../../functions.js';

const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * A push setup the person asked for that cannot be completed. `code` is the
 * translation key that explains why.
 */
export class PushSetupError extends Error {
  /**
   * @param {string} code - Translation key
   * @param {Error} [cause] - Underlying error
   */
  constructor(code, cause) {
    super(code, { cause });
    this.name = 'PushSetupError';
    this.code = code;
  }
}

/**
 * The VAPID public key the server signs pushes with.
 *
 * @returns {Promise<string>}
 * @throws {PushSetupError} push_not_configured when the server has no key
 * @throws {Error} The API error when the server cannot be reached
 */
async function fetchServerVapidKey() {
  let response;
  try {
    response = await makeApiRequest('v1/notifications/vapid-public-key');
  } catch (error) {
    if (error?.status === HTTP_SERVICE_UNAVAILABLE && !error.isNetworkError) {
      throw new PushSetupError('push_not_configured', error);
    }
    throw error;
  }
  if (!response?.data?.publicKey) {
    throw new PushSetupError('push_not_configured');
  }
  return response.data.publicKey;
}

/**
 * Whether an existing subscription was made with another server key. Browsers
 * that do not expose the key are given the benefit of the doubt.
 *
 * @param {PushSubscription} subscription
 * @param {Uint8Array} applicationServerKey
 * @returns {boolean}
 */
function isSubscribedWithOtherKey(subscription, applicationServerKey) {
  const currentKey = subscription.options?.applicationServerKey;
  if (!currentKey) {
    return false;
  }
  const currentBytes = new Uint8Array(currentKey);
  return currentBytes.length !== applicationServerKey.length
    || currentBytes.some((byte, index) => byte !== applicationServerKey[index]);
}

/**
 * Subscribe with the server key, replacing a subscription made with another
 * one: it could never receive this server's pushes, and subscribe() refuses a
 * new key while it exists.
 *
 * @param {PushManager} pushManager
 * @param {PushSubscription|null} existing
 * @param {Uint8Array} applicationServerKey
 * @returns {Promise<PushSubscription>}
 */
async function subscribeWithKey(pushManager, existing, applicationServerKey) {
  const options = { userVisibleOnly: true, applicationServerKey };
  if (existing && isSubscribedWithOtherKey(existing, applicationServerKey)) {
    await existing.unsubscribe();
    return pushManager.subscribe(options);
  }
  try {
    // With the same key, this returns the browser's current subscription.
    return await pushManager.subscribe(options);
  } catch (error) {
    // The browser hid the old key, but refuses the new one
    if (!existing) {
      throw error;
    }
    await existing.unsubscribe();
    return pushManager.subscribe(options);
  }
}

/**
 * Record this browser's subscription for the signed-in member.
 *
 * @param {PushSubscriptionJSON} subscription
 * @returns {Promise<void>}
 * @throws {PushSetupError} push_browser_refused when the browser gave no keys
 */
async function sendSubscriptionToServer(subscription) {
  const { endpoint, expirationTime, keys = {} } = subscription;
  if (!keys.p256dh || !keys.auth) {
    throw new PushSetupError('push_browser_refused');
  }

  await makeApiRequest('v1/notifications/subscription', {
    method: 'POST',
    body: { endpoint, expirationTime, keys: { p256dh: keys.p256dh, auth: keys.auth } },
  });
  debugLog('Push subscription saved on server');
}

/**
 * Subscribe with the server key and record the subscription.
 *
 * @param {PushManager} pushManager
 * @param {PushSubscription|null} existing
 * @param {string} serverKey - Base64url VAPID public key
 * @returns {Promise<void>}
 */
async function subscribeAndSave(pushManager, existing, serverKey) {
  let subscription;
  try {
    subscription = await subscribeWithKey(pushManager, existing, urlBase64ToUint8Array(serverKey));
  } catch (error) {
    // The browser or its push service said no: a blocked push service
    // (Brave without Google push messaging), a private window, a bad key.
    throw new PushSetupError('push_browser_refused', error);
  }
  await sendSubscriptionToServer(subscription.toJSON());
}

/**
 * Whether this browser can receive push notifications at all.
 *
 * @returns {boolean}
 */
export function isPushSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

/**
 * Turn push notifications on for this browser, at the person's request.
 * Notification permission must already be granted.
 *
 * @returns {Promise<void>}
 * @throws {PushSetupError} push_not_configured or push_browser_refused
 * @throws {Error} The API error when saving the subscription fails
 */
export async function enablePushNotifications() {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const serverKey = await fetchServerVapidKey();
  await subscribeAndSave(registration.pushManager, existing, serverKey);
}

/**
 * Turn push notifications off for this browser: forget it on the server, then
 * unsubscribe. The browser is unsubscribed even when the server cannot be
 * told; the server drops the endpoint at its next send.
 *
 * @returns {Promise<void>}
 */
export async function disablePushNotifications() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }
  try {
    await makeApiRequest('v1/notifications/subscription', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
    });
  } catch (error) {
    debugWarn('Could not remove the push subscription on the server', error);
  }
  await subscription.unsubscribe();
}

/**
 * Subscribe this browser to push notifications and register it on the server,
 * after sign-in. Requires notification permission to be granted already.
 * Failures are logged, never thrown: push is an enhancement.
 *
 * @returns {Promise<void>}
 */
export async function registerPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    let serverKey = null;
    try {
      serverKey = await fetchServerVapidKey();
    } catch (error) {
      debugWarn('Could not load the push key from the server', error);
    }

    if (serverKey) {
      await subscribeAndSave(registration.pushManager, existing, serverKey);
    } else if (existing) {
      // Without word from the server, an existing subscription is never
      // replaced on a guess; it is recorded again as it is.
      await sendSubscriptionToServer(existing.toJSON());
    } else {
      // Nothing subscribed: subscribe with the built-in key.
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CONFIG.PUSH_NOTIFICATIONS.VAPID_PUBLIC_KEY),
      });
      await sendSubscriptionToServer(subscription.toJSON());
    }
  } catch (error) {
    debugError('Error during push subscription:', error);
  }
}
