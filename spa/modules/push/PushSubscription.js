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

/**
 * The VAPID public key the server signs pushes with, or null when the server
 * cannot be asked (offline, push not configured).
 *
 * @returns {Promise<string|null>}
 */
async function fetchServerVapidKey() {
  try {
    const response = await makeApiRequest('v1/notifications/vapid-public-key');
    return response?.data?.publicKey || null;
  } catch (error) {
    debugWarn('Could not load the push key from the server', error);
    return null;
  }
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
 */
async function sendSubscriptionToServer(subscription) {
  const { endpoint, expirationTime, keys = {} } = subscription;
  if (!keys.p256dh || !keys.auth) {
    debugError('Push subscription has no p256dh or auth key');
    return;
  }

  await makeApiRequest('v1/notifications/subscription', {
    method: 'POST',
    body: { endpoint, expirationTime, keys: { p256dh: keys.p256dh, auth: keys.auth } },
  });
  debugLog('Push subscription saved on server');
}

/**
 * Subscribe this browser to push notifications and register it on the server.
 * Requires notification permission to be granted already. Failures are logged,
 * never thrown: push is an enhancement.
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
    const serverKey = await fetchServerVapidKey();

    let subscription = existing;
    if (serverKey) {
      subscription = await subscribeWithKey(registration.pushManager, existing, urlBase64ToUint8Array(serverKey));
    } else if (!existing) {
      // Without word from the server, only a browser with no subscription at
      // all subscribes, with the built-in key. An existing one is never
      // replaced on a guess.
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CONFIG.PUSH_NOTIFICATIONS.VAPID_PUBLIC_KEY),
      });
    }

    await sendSubscriptionToServer(subscription.toJSON());
  } catch (error) {
    debugError('Error during push subscription:', error);
  }
}
