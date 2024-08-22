// Cache name
const CACHE_NAME = 'points-app-v1.63';

import { openDB, saveOfflineData, getOfflineData, clearOfflineData } from './js/indexedDB.js';

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
  '/js/health_contact_report.js',
  '/js/attendance_report.js',
  '/manifest.json',
  '/offline.html',
  '/images/6eASt-Paul.png',
  '/images/icon-192x192.png',
  '/health_contact_report.php',
  '/attendance_report.php',
  '/generate_attendance_report.php',
  '/generate_health_contact_report.php',
  '/get_translations.php',
  '/lang/fr.php',
  '/lang/en.php'
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
  return url.origin === self.location.origin && (url.protocol === 'http:' || url.protocol === 'https:');
}

// Fetch event
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !isRequestCacheable(event.request)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }

        return fetch(event.request, { redirect: 'follow' }) // Ensures redirects are followed
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });
              return networkResponse;
            } else {
              return caches.match('/offline.html');
            }
          })
          .catch(() => {
            return caches.match('/offline.html').then((fallbackResponse) => {
              return fallbackResponse || new Response('You are offline and the requested resource is not available.', {
                headers: { 'Content-Type': 'text/plain' }
              });
            });
          });
      })
  );
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
    // Rebuild the cache after clearing
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).then(() => {
        console.log('Cache rebuilt');
      }).catch((error) => {
        console.error('Error rebuilding cache:', error);
      });
    });
  });
}

function updateCache() {
  return caches.open(CACHE_NAME).then((cache) => {
    // Step 1: Add new resources to the cache
    return cache.addAll(urlsToCache).then(() => {
      console.log('Cache updated with new resources');

      // Step 2: Now clear out old entries that are no longer needed
      return cache.keys().then((cacheKeys) => {
        const deletionPromises = cacheKeys.map((cacheKey) => {
          const requestUrl = new URL(cacheKey.url).pathname;
          if (!urlsToCache.includes(requestUrl)) {
            console.log(`Deleting outdated cache entry: ${requestUrl}`);
            return cache.delete(cacheKey);
          }
        });

        return Promise.all(deletionPromises); // Ensure all deletions are completed
      });
    });
  }).catch((error) => {
    console.error('Error updating cache:', error);
  });
}



// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    updateCache().then(() => {
      console.log('Cache has been updated and old entries removed');
      return self.clients.claim();
    })
  );
});


// Sync event
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-points') {
    event.waitUntil(syncPoints());
  }
});


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

self.addEventListener('message', (event) => {
  if (event.data === 'updateCache') {
     console.log('Cache update triggered via message, not updating');
  }
});
