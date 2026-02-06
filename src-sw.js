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
const APP_VERSION = '3.0.7';

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

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
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
  const db = await openIndexedDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const cacheEntry = {
    url: key,
    data: data,
    expiration: Date.now() + expirationTime,
  };
  store.put(cacheEntry);
}

async function getCachedData(key) {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
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
}

async function fetchAndCacheInIndexedDB(request) {
  const cacheKey = request.url;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const data = await networkResponse.json();
      await setCachedData(cacheKey, data, 24 * 60 * 60 * 1000);
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
  const db = await openIndexedDB();
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
  const db = await openIndexedDB();
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
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MUTATION_STORE_NAME], 'readonly');
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

async function deletePendingMutation(id) {
  const db = await openIndexedDB();
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
    icon: data.icon || '/assets/images/icon-192x192.png',
    badge: '/assets/images/badge-128x128.png',
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
            const endpoint = item.action
              ? `/api/${item.action.replace('_', '-')}`
              : item.url;

            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.data),
            });

            if (response.ok) {
              await clearOfflineData(item.id);
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
    saveOfflineMutation(mutation).then(() => {
      debugLog('Mutation queued via message:', mutation.url);
    }).catch((err) => {
      debugError('Failed to queue mutation via message:', err);
    });
  }
});

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
