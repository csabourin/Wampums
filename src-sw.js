// ==================================================================
// Wampums Service Worker (Workbox InjectManifest)
// ==================================================================
// This SW uses Workbox for precaching and routing while preserving
// custom logic for push notifications, offline mutation queueing,
// background sync, IndexedDB API caching, and version messaging.
// ==================================================================

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// ==================================================================
// Section 1: Version & Debug Helpers
// ==================================================================

// Version should match package.json and config.js
const APP_VERSION = '3.1.0';

// Camp mode flag - when enabled, use extended cache durations
let campModeEnabled = false;

// Cache duration constants (in milliseconds)
const CACHE_DURATION = {
  STANDARD: 24 * 60 * 60 * 1000,       // 24 hours
  CAMP_MODE: 10 * 24 * 60 * 60 * 1000, // 10 days
};

/**
 * Get cache duration based on camp mode and URL
 * Date-dependent endpoints get extended cache in camp mode
 */
function getCacheDuration(url) {
  if (!campModeEnabled) {
    return CACHE_DURATION.STANDARD;
  }

  // In camp mode, extend cache for date-dependent endpoints
  const pathname = typeof url === 'string' ? new URL(url, self.location.origin).pathname : url.pathname;
  const campModeEndpoints = [
    '/attendance',
    '/honors',
    '/medication',
    '/badges',
    '/participants',
    '/groups'
  ];

  if (campModeEndpoints.some(endpoint => pathname.includes(endpoint))) {
    return CACHE_DURATION.CAMP_MODE;
  }

  return CACHE_DURATION.STANDARD;
}

const isProduction = () => {
  try {
    return self.location?.hostname?.endsWith('.app') || false;
  } catch (e) {
    return false;
  }
};
const debugLog = (...args) => { if (!isProduction()) console.log(...args); };
const debugError = (...args) => { console.error(...args); };
const debugWarn = (...args) => { if (!isProduction()) console.warn(...args); };

// ==================================================================
// Section 2: Workbox Precaching
// ==================================================================

// Workbox injects the precache manifest here at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ==================================================================
// Section 3: SPA Navigation Fallback
// ==================================================================

const navigationHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [
    /^\/api\//,
    /^\/public\//,
    /^\/offline\.html$/,
    /^\/manifest\.json$/,
    /^\/manifest\.webmanifest$/,
    /^\/__replco\//,
    /^\/en\/?$/,           // Allow /en and /en/ to serve static English landing page
    /^\/fr\/?$/,           // Allow /fr and /fr/ to serve static French landing page
    /^\/landing\//,         // Allow /landing/* to serve landing pages
  ],
});
registerRoute(navigationRoute);

// ==================================================================
// Section 4: Runtime Caching Routes
// ==================================================================

// 4a. Font Awesome CDN (CacheFirst, long TTL)
registerRoute(
  ({ url }) => url.hostname === 'cdnjs.cloudflare.com' && url.pathname.includes('font-awesome'),
  new CacheFirst({
    cacheName: 'font-awesome-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// 4b. Google Fonts (CacheFirst, 1 year)
registerRoute(
  ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// 4c. Translation files (StaleWhileRevalidate - serve from cache, refresh in background)
registerRoute(
  ({ url }) => url.pathname.startsWith('/lang/') && url.pathname.endsWith('.json'),
  new StaleWhileRevalidate({
    cacheName: 'translations-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 7 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// 4d. API routes (GET only) - custom handler using IndexedDB caching
registerRoute(
  ({ url, request }) => {
    if (request.method !== 'GET') return false;
    return url.pathname.startsWith('/api/') || url.pathname.startsWith('/public/');
  },
  ({ request }) => fetchAndCacheInIndexedDB(request)
);

// 4e. Images (CacheFirst, skip Supabase to avoid CORS issues)
registerRoute(
  ({ request, url }) => {
    if (request.destination !== 'image') return false;
    if (url.hostname.includes('supabase.co')) return false;
    return true;
  },
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// 4f. config.js - NetworkOnly (must never be cached to avoid stale config)
registerRoute(
  ({ url }) => url.pathname === '/config.js' || url.pathname.endsWith('/config.js'),
  new NetworkOnly()
);

// ==================================================================
// Section 5: Custom API Handler with IndexedDB
// ==================================================================

const DB_NAME = 'wampums-cache';
const DB_VERSION = 2;
const STORE_NAME = 'api-cache';
const MUTATION_STORE_NAME = 'pending-mutations';

let indexedDBBlocked = false;

function isStorageAccessError(error) {
  return error && (
    error.name === 'SecurityError' ||
    error.name === 'InvalidStateError' ||
    error.name === 'QuotaExceededError'
  );
}

function isAuthEndpoint(url) {
  const pathname = url?.pathname || '';
  return (
    pathname.startsWith('/public/login') ||
    pathname.startsWith('/public/verify-2fa') ||
    pathname.startsWith('/api/auth/')
  );
}

function openIndexedDB() {
  if (indexedDBBlocked || !self.indexedDB) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      if (isStorageAccessError(error)) {
        indexedDBBlocked = true;
      }
      reject(error);
      return;
    }

    request.onerror = () => {
      if (isStorageAccessError(request.error)) {
        indexedDBBlocked = true;
      }
      reject(request.error);
    };
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }

      if (!db.objectStoreNames.contains(MUTATION_STORE_NAME)) {
        const mutationStore = db.createObjectStore(MUTATION_STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        mutationStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

async function setCachedData(key, data, expirationTime) {
  if (indexedDBBlocked) {
    return;
  }
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const cacheEntry = {
      url: key,
      data: data,
      expiration: Date.now() + expirationTime,
    };
    store.put(cacheEntry);
  } catch (error) {
    if (isStorageAccessError(error)) {
      indexedDBBlocked = true;
    }
  }
}

async function getCachedData(key) {
  if (indexedDBBlocked) {
    return null;
  }
  try {
    const db = await openIndexedDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.expiration > Date.now()) {
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
    });
  } catch (error) {
    if (isStorageAccessError(error)) {
      indexedDBBlocked = true;
    }
    return null;
  }
}

async function fetchAndCacheInIndexedDB(request) {
  const cacheKey = request.url;

  try {
    if (indexedDBBlocked) {
      return await fetch(request);
    }
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const data = await networkResponse.json();
      const cacheDuration = getCacheDuration(cacheKey);
      await setCachedData(cacheKey, data, cacheDuration);
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    debugWarn('API responded with', networkResponse.status, 'for', cacheKey);
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      debugLog('Serving cached data after network error:', cacheKey);
      return new Response(JSON.stringify(cachedData), {
        headers: { 'Content-Type': 'application/json', 'X-From-Cache': 'true' },
      });
    }

    return networkResponse;
  } catch (error) {
    debugError('Network request failed, attempting to serve from cache:', error);

    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      debugLog('Serving from cache:', cacheKey);
      return new Response(JSON.stringify(cachedData), {
        headers: { 'Content-Type': 'application/json', 'X-From-Cache': 'true' },
      });
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: 'No data available - offline and no cached data',
        offline: true,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// ==================================================================
// Section 6: Mutation Handling (POST/PUT/DELETE/PATCH)
// ==================================================================

async function handleMutation(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      await invalidateRelatedCaches(request);
      return response;
    }

    return response;
  } catch (error) {
    debugError('Mutation failed, saving for background sync:', error);

    try {
      const requestData = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries([...request.headers.entries()]),
        body: request.method !== 'GET' ? await request.clone().text() : null,
        timestamp: Date.now(),
      };

      await saveOfflineMutation(requestData);

      if ('sync' in self.registration) {
        await self.registration.sync.register('sync-mutations');
      }

      return new Response(
        JSON.stringify({
          success: true,
          queued: true,
          message: 'Request queued for sync when online',
        }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (saveError) {
      debugError('Failed to save mutation for sync:', saveError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to queue request for sync',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }
}

async function invalidateRelatedCaches(request) {
  const url = new URL(request.url);
  if (indexedDBBlocked) {
    return;
  }
  let db;
  try {
    db = await openIndexedDB();
  } catch (error) {
    if (isStorageAccessError(error)) {
      indexedDBBlocked = true;
    }
    return;
  }
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const allKeys = await new Promise((resolve) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  const keysToInvalidate = allKeys.filter((key) => {
    if (url.pathname.includes('/participants'))
      return key.toString().includes('participants');
    if (url.pathname.includes('/groups'))
      return key.toString().includes('group');
    if (url.pathname.includes('/attendance'))
      return key.toString().includes('attendance');
    if (url.pathname.includes('/points'))
      return key.toString().includes('points');
    if (url.pathname.includes('/honors'))
      return key.toString().includes('honors');
    if (url.pathname.includes('/badges'))
      return key.toString().includes('badge');
    return false;
  });

  for (const key of keysToInvalidate) {
    try {
      await new Promise((resolve, reject) => {
        const deleteRequest = store.delete(key);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject();
      });
    } catch (error) {
      debugWarn('Failed to invalidate cache key:', key);
    }
  }
}

async function saveOfflineMutation(mutationData) {
  if (indexedDBBlocked) {
    return null;
  }
  let db;
  try {
    db = await openIndexedDB();
  } catch (error) {
    if (isStorageAccessError(error)) {
      indexedDBBlocked = true;
    }
    return null;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MUTATION_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.add(mutationData);

    request.onerror = () => {
      debugError('Error saving offline mutation:', request.error);
      reject(request.error);
    };
    request.onsuccess = () => {
      debugLog('Offline mutation saved:', mutationData);
      resolve(request.result);
    };
  });
}

async function getPendingMutations() {
  if (indexedDBBlocked) {
    return [];
  }
  let db;
  try {
    db = await openIndexedDB();
  } catch (error) {
    if (isStorageAccessError(error)) {
      indexedDBBlocked = true;
    }
    return [];
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MUTATION_STORE_NAME], 'readonly');
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

async function deletePendingMutation(id) {
  if (indexedDBBlocked) {
    return;
  }
  let db;
  try {
    db = await openIndexedDB();
  } catch (error) {
    if (isStorageAccessError(error)) {
      indexedDBBlocked = true;
    }
    return;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MUTATION_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      debugLog('Deleted pending mutation:', id);
      resolve();
    };
  });
}

// Intercept non-GET requests for offline mutation handling
self.addEventListener('fetch', (event) => {
  const method = event.request.method;
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    const url = new URL(event.request.url);
    if (isAuthEndpoint(url)) {
      return;
    }
    event.respondWith(handleMutation(event.request));
  }
});

// ==================================================================
// Section 7: Push Notifications
// ==================================================================

self.addEventListener('push', function (event) {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
      debugLog('Push event data received:', data);
    } catch (e) {
      debugError('Error parsing push notification data:', e);
    }
  }

  const title = data.title || 'New Notification';
  const options = {
    body: data.body || 'You have a new message.',
    icon: data.icon || '/images/icon-192x192.png',
    badge: '/images/badge-128x128.png',
    tag: data.tag || 'general',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const notificationData = event.notification.data;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === notificationData?.url && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow && notificationData?.url) {
          return clients.openWindow(notificationData.url);
        }
      })
  );
});

// ==================================================================
// Section 8: Background Sync
// ==================================================================

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data' || event.tag === 'sync-mutations') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  if (!navigator.onLine) {
    debugLog('Device is offline, cannot sync');
    return;
  }

  try {
    const pendingMutations = await getPendingMutations();
    debugLog(`Found ${pendingMutations.length} pending mutations to sync`);

    for (const mutation of pendingMutations) {
      try {
        const mutationUrl = new URL(mutation.url);
        if (isAuthEndpoint(mutationUrl)) {
          debugLog('Dropping auth mutation from sync queue:', mutation.id);
          await deletePendingMutation(mutation.id);
          continue;
        }
        debugLog('Syncing mutation:', mutation);

        const response = await fetch(mutation.url, {
          method: mutation.method,
          headers: mutation.headers,
          body: mutation.body,
        });

        if (response.ok) {
          debugLog('Mutation synced successfully:', mutation.id);
          await deletePendingMutation(mutation.id);

          const request = new Request(mutation.url, {
            method: mutation.method,
            headers: mutation.headers,
          });
          await invalidateRelatedCaches(request);
        } else {
          debugError('Failed to sync mutation:', mutation.id, response.statusText);

          if (response.status >= 400 && response.status < 500) {
            debugLog('Client error, removing mutation:', mutation.id);
            await deletePendingMutation(mutation.id);
          }
        }
      } catch (error) {
        debugError('Error syncing mutation:', mutation.id, error);
      }
    }

    // Backward compatibility: sync old format offline data from WampumsAppDB
    try {
      const offlineData = await getOfflineData();
      if (offlineData && offlineData.length > 0) {
        debugLog(`Found ${offlineData.length} old format offline items to sync`);
        for (let item of offlineData) {
          try {
            debugLog('Syncing old format item:', item);

            // New format: stored by OfflineManager.storePendingMutation fallback
            // item.data has { url, headers, body, timestamp }
            if (item.data?.url) {
              const response = await fetch(item.data.url, {
                method: item.action || item.data.method || 'POST',
                headers: item.data.headers || { 'Content-Type': 'application/json' },
                body: item.data.body,
              });

              if (response.ok) {
                await clearOfflineData(item.key);
                const request = new Request(item.data.url, {
                  method: item.action || item.data.method || 'POST',
                  headers: item.data.headers || {},
                });
                await invalidateRelatedCaches(request);
              } else if (response.status === 400 || response.status === 404 || response.status === 409) {
                // Non-retryable client errors — discard
                debugWarn('Server rejected mutation, discarding:', response.status);
                await clearOfflineData(item.key);
              } else {
                // 401/403/429/5xx — leave for retry (OfflineManager can retry with fresh JWT)
                debugError('Failed to sync new format item (will retry):', response.status);
              }
              continue;
            }

            // Legacy format: action="updatePoints", data={type, id, points, ...}
            const endpoint = item.action
              ? `/api/${item.action.replace('_', '-')}`
              : item.url;

            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.data),
            });

            if (response.ok) {
              await clearOfflineData(item.key);
            } else {
              debugError('Failed to sync old format item:', item, response.statusText);
            }
          } catch (error) {
            debugError('Error syncing old format item:', item, error);
          }
        }
      }
    } catch (error) {
      debugLog('No old format offline data found');
    }

    debugLog('Sync completed');
  } catch (error) {
    debugError('Error during data sync:', error);
  }
}

// Get offline data (backward compatibility with old WampumsAppDB format)
async function getOfflineData() {
  try {
    return new Promise((resolve) => {
      const request = indexedDB.open('WampumsAppDB', 12);
      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('offlineData')) {
          resolve([]);
          return;
        }
        const transaction = db.transaction(['offlineData'], 'readonly');
        const store = transaction.objectStore('offlineData');
        const index = store.index('type_idx');
        const getRequest = index.getAll('offline');

        getRequest.onsuccess = () => resolve(getRequest.result || []);
        getRequest.onerror = () => resolve([]);
      };
      request.onerror = () => resolve([]);
    });
  } catch (error) {
    debugError('Error getting offline data:', error);
    return [];
  }
}

async function clearOfflineData(key) {
  try {
    return new Promise((resolve) => {
      const request = indexedDB.open('WampumsAppDB', 12);
      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('offlineData')) {
          resolve();
          return;
        }
        const transaction = db.transaction(['offlineData'], 'readwrite');
        const store = transaction.objectStore('offlineData');
        const deleteRequest = store.delete(key);

        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve();
      };
      request.onerror = () => resolve();
    });
  } catch (error) {
    debugError('Error clearing offline data:', error);
  }
}

// ==================================================================
// Section 9: Message Handling
// ==================================================================

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({
      type: 'VERSION_INFO',
      version: APP_VERSION,
    });
  }
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'UPDATE_AVAILABLE',
          version: APP_VERSION,
        });
      });
    });
  }
  if (event.data && event.data.type === 'QUEUE_MUTATION') {
    const mutation = event.data.mutation;
    event.waitUntil(
      saveOfflineMutation(mutation).then(() => {
        debugLog('Mutation queued via message:', mutation.url);
      }).catch((err) => {
        debugError('Failed to queue mutation via message:', err);
      })
    );
  }
  if (event.data && event.data.type === 'SET_CAMP_MODE') {
    campModeEnabled = event.data.enabled;
    debugLog('Camp mode:', campModeEnabled ? 'enabled' : 'disabled');
  }
  if (event.data && event.data.type === 'GET_PENDING_COUNT') {
    const messagePort = event.ports && event.ports[0];
    if (!messagePort) {
      debugError('GET_PENDING_COUNT: No message port available');
      return;
    }
    // Count from both legacy SW mutation store and new Dexie outbox
    Promise.all([
      getPendingMutations().catch(() => []),
      getOutboxPendingCount().catch(() => 0),
    ])
      .then(([swItems, outboxCount]) => {
        const swCount = Array.isArray(swItems) ? swItems.length : 0;
        messagePort.postMessage({
          type: 'PENDING_COUNT',
          count: swCount + outboxCount,
        });
      })
      .catch((err) => {
        debugError('Failed to get pending mutations count:', err);
        messagePort.postMessage({ type: 'PENDING_COUNT', count: 0 });
      });
  }

  // New: Get pending count from the Dexie-based outbox (WampumsOfflineDB)
  if (event.data && event.data.type === 'GET_OUTBOX_COUNT') {
    const messagePort = event.ports && event.ports[0];
    if (!messagePort) return;
    getOutboxPendingCount()
      .then((count) => {
        messagePort.postMessage({ type: 'OUTBOX_COUNT', count });
      })
      .catch(() => {
        messagePort.postMessage({ type: 'OUTBOX_COUNT', count: 0 });
      });
  }
});

// ==================================================================
// Section 9b: Read from new Dexie-based outbox (WampumsOfflineDB)
// ==================================================================

/**
 * Read pending outbox count from the new WampumsOfflineDB._outbox store.
 * This provides a unified pending count across both old and new systems.
 * @returns {Promise<number>}
 */
async function getOutboxPendingCount() {
  try {
    return new Promise((resolve) => {
      const request = indexedDB.open('WampumsOfflineDB', 1);
      request.onsuccess = (event) => {
        const outboxDb = event.target.result;
        if (!outboxDb.objectStoreNames.contains('_outbox')) {
          outboxDb.close();
          resolve(0);
          return;
        }
        const transaction = outboxDb.transaction(['_outbox'], 'readonly');
        const store = transaction.objectStore('_outbox');
        const index = store.index('status');
        const countRequest = index.count('pending');

        countRequest.onsuccess = () => {
          outboxDb.close();
          resolve(countRequest.result || 0);
        };
        countRequest.onerror = () => {
          outboxDb.close();
          resolve(0);
        };
      };
      request.onerror = () => resolve(0);
      // If the DB doesn't exist yet, onupgradeneeded fires but we don't
      // want to create stores from the SW. Just return 0.
      request.onupgradeneeded = (event) => {
        event.target.transaction.abort();
        resolve(0);
      };
    });
  } catch (error) {
    debugError('Error reading outbox count from WampumsOfflineDB:', error);
    return 0;
  }
}

// ==================================================================
// Section 10: Activate Handler
// ==================================================================

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean up old hand-written SW caches
      const cacheNames = await caches.keys();
      const oldCachePrefixes = ['wampums-app-v', 'wampums-static-v', 'wampums-api-v', 'wampums-images-v'];
      await Promise.all(
        cacheNames
          .filter((name) => oldCachePrefixes.some((prefix) => name.startsWith(prefix)))
          .map((name) => caches.delete(name))
      );
      // Claim all clients
      await self.clients.claim();
    })()
  );
});
