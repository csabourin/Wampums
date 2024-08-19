// Cache name
const CACHE_NAME = 'points-app-v1.37';

// Files to cache
const urlsToCache = [
  '/',
  '/index.php',
  '/dashboard.php',
  '/manage_points.php',
  '/attendance.php',
  '/manage_honors.php',
  '/css/styles.css',
  '/js/app.js',
  '/js/functions.js',
  '/js/points_script.js',
  '/js/indexedDB.js',
  '/manifest.json',
  '/offline.html'
];

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Helper function to check if a request's URL is supported for caching
function isRequestCacheable(request) {
  const url = new URL(request.url);
  return url.protocol === 'http:' || url.protocol === 'https:';
}

// Fetch event
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !isRequestCacheable(event.request)) {
    return;
  }

  const url = new URL(event.request.url);

  // Network-first strategy with cache fallback for dynamic content
  if (url.pathname.includes('get_points_data.php') || url.pathname.includes('update_points.php')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Clone the response before caching it
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first strategy with network update for other requests
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          const fetchPromise = fetch(event.request).then(
            (networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, responseToCache);
                });
              }
              return networkResponse;
            }
          );
          return response || fetchPromise;
        })
    );
  }
});

// Add a new message event listener to handle cache updates
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  } else if (event.data === 'clearCache') {
    clearCache();
  }
});

// Function to clear the entire cache
function clearCache() {
  caches.delete(CACHE_NAME).then(() => {
    console.log('Cache cleared');
  });
}

// Activate event
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Sync event
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-points') {
    event.waitUntil(syncPoints());
  }
});

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PointsAppDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore('offlineData', { autoIncrement: true });
    };
  });
}

function getOfflineData() {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['offlineData'], 'readonly');
      const store = transaction.objectStore('offlineData');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  });
}

function clearOfflineData() {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['offlineData'], 'readwrite');
      const store = transaction.objectStore('offlineData');
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  });
}

function syncPoints() {
  return getOfflineData()
    .then(offlineData => {
      if (offlineData.length === 0) {
        console.log('No offline data to sync');
        return Promise.resolve();
      }

      return fetch('/sync_data.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(offlineData)
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          console.log('Offline data synced successfully');
          return clearOfflineData();
        } else {
          throw new Error('Sync failed: ' + (data.error || 'Unknown error'));
        }
      });
    })
    .catch(error => {
      console.error('Sync error:', error);
      // Optionally, you could retry the sync after a delay
      setTimeout(() => syncPoints(), 60000); // Retry after 1 minute
    });
}

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});