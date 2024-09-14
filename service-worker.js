const CACHE_NAME = 'wampums-app-v1.1';
const STATIC_CACHE_NAME = 'wampums-static-v1.1';
const API_CACHE_NAME = 'wampums-api-v1.1';

const staticAssets = [
    '/',
    '/index.php',
    '/css/styles.css',
    '/spa/app.js',
    '/spa/dashboard.js',
    '/spa/parent_dashboard.js',
    '/spa/indexedDB.js',
    '/spa/ajax-functions.js',
    '/manifest.json',
    '/images/icon-192x192.png',
    '/images/icon-512x512.png',
    '/images/6eASt-Paul.png',
];

const apiRoutes = [
    '/api.php',
    '/get_translations.php',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE_NAME)
            .then((cache) => cache.addAll(staticAssets))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE_NAME && cacheName !== API_CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip requests with unsupported schemes like 'chrome-extension'
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return; // Exit early if the scheme is not supported
    }

    // Handle POST requests separately
    if (event.request.method === 'POST') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    if (staticAssets.includes(url.pathname)) {
        event.respondWith(cacheFirst(event.request));
    } else if (apiRoutes.some(route => url.pathname.includes(route))) {
        event.respondWith(networkFirst(event.request));
    } else {
        event.respondWith(networkFirst(event.request));
    }
});


async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }
    return fetch(request).then((response) => {
        if (response.ok) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
            });
        }
        return response;
    });
}

async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok && request.method !== 'POST') {
            const responseClone = networkResponse.clone();
            caches.open(API_CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
            });
        }
        return networkResponse;
    } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        throw error;
    }
}

// Handle cache updates
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});

// Sync event for background syncing
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-data') {
        event.waitUntil(syncData());
    }
});

async function syncData() {
    try {
        const offlineData = await getOfflineData();
        if (offlineData.length > 0) {
            for (let item of offlineData) {
                // Implement your sync logic here for each item
                console.log('Syncing item:', item);
                // Example: POST the data to your server
                const response = await fetch('/api.php?action=' + item.action, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(item.data)
                });

                if (response.ok) {
                    // Optionally remove the item from IndexedDB after a successful sync
                    await clearOfflineData(item.id);
                } else {
                    console.error('Failed to sync item:', item, response.statusText);
                }
            }
            console.log('All data synced successfully');
        }
    } catch (error) {
        console.error('Error during data sync:', error);
    }
}


async function staleWhileRevalidate(request) {
    const cache = await caches.open(API_CACHE_NAME);
    const cachedResponse = await cache.match(request);
    const networkFetch = fetch(request).then((response) => {
        cache.put(request, response.clone());
        return response;
    });
    return cachedResponse || networkFetch;
}
