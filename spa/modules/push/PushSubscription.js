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
 * The VAPID public key the server signs pushes with. The build-time key is
 * only a fallback: a browser subscribed with a key other than the server's
 * never receives anything.
 *
 * @returns {Promise<string>}
 */
async function fetchVapidPublicKey() {
  try {
    const response = await makeApiRequest('v1/notifications/vapid-public-key');
    if (response?.data?.publicKey) {
      return response.data.publicKey;
    }
  } catch (error) {
    debugWarn('Could not load the push key from the server; using the built-in key', error);
  }
  return CONFIG.PUSH_NOTIFICATIONS.VAPID_PUBLIC_KEY;
}

/**
 * Whether an existing subscription was made with the given server key.
 *
 * @param {PushSubscription} subscription
 * @param {Uint8Array} applicationServerKey
 * @returns {boolean}
 */
function isSubscribedWithKey(subscription, applicationServerKey) {
  const currentKey = subscription.options?.applicationServerKey;
  if (!currentKey) {
    return false;
  }
  const currentBytes = new Uint8Array(currentKey);
  return currentBytes.length === applicationServerKey.length
    && currentBytes.every((byte, index) => byte === applicationServerKey[index]);
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
    const applicationServerKey = urlBase64ToUint8Array(await fetchVapidPublicKey());

    // Reuse this browser's subscription so it keeps one endpoint. One made
    // with another key cannot receive this server's pushes, and subscribe()
    // refuses a new key while it exists: replace it.
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !isSubscribedWithKey(subscription, applicationServerKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    await sendSubscriptionToServer(subscription.toJSON());
  } catch (error) {
    debugError('Error during push subscription:', error);
  }
}
