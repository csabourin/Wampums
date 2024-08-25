// Cache name
const CACHE_NAME = 'points-app-v2.6';

import { openDB, saveOfflineData, getOfflineData, clearOfflineData } from './js/indexedDB.js';

const cacheOnlyUrls = [
  '/images/icon-192x192.png',
  '/images/6eASt-Paul.png',
  '/manifest.json',
  '/css/styles.css',
  '/js/indexedDB.js',
  '/js/app.js',
  '/js/functions.js',
  '/js/points_manager.js',
  '/js/health_contact_report.js',
  '/js/attendance_report.js',
  '/lang/fr.php',
  '/lang/en.php',
  '/favicon.ico'
  // add more static files
];

const urlsToCache = [
  '/',
  '/index.php',
  '/dashboard.php',
  '/manage_points.php',
  '/manage_honors.php',
  '/attendance.php',
  '/approve_badges.php',
  '/badge_form.php',
  '/fiche_sante.php',
  '/formulaire_inscription.php',
  '/acceptation_risque.php',
  '/view_participant_documents.php',
  '/health_contact_report.php',
  '/attendance_report.php',
  '/parent_contact_list.php',
  '/css/styles.css',
  '/js/app.js',
  '/js/functions.js',
  '/js/indexedDB.js',
  '/js/points_manager.js',
  '/js/attendance_report.js',
  '/js/health_contact_report.js',
  '/js/parent_contact_list.js',
  '/js/inscription.js',
  '/js/fiche_sante.js',
  '/js/acceptation_risque.js',
  '/js/inactivity-timer.js',
  '/get_translations.php',
  '/lang/fr.php',
  '/lang/en.php',
  '/manifest.json',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png',
  '/images/6eASt-Paul.png',
  '/images/kaa.jpg',
  '/images/baloo.jpg',
  '/images/rikki.jpg',
  '/images/bagheera.jpg',
  '/images/ferao.jpg',
  '/images/frereGris.jpg',
  '/offline.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return Promise.all(
          urlsToCache.map((url, index) => {
            return cache.add(url).then(() => {
              const progress = Math.round(((index + 1) / urlsToCache.length) * 100);
              self.clients.matchAll().then(clients => {
                clients.forEach(client => client.postMessage({
                  type: 'cacheProgress',
                  progress: progress
                }));
              });
            });
          })
        );
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
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Skip caching for dynamic pages
  if (url.pathname.startsWith('/dashboard.php') || url.pathname.endsWith('.php')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        return caches.match('/offline.html');
      });
    })
  );
});






self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-points') {
      event.waitUntil(syncPoints());
  }
});

async function syncPoints() {
  const offlineData = await getOfflineData();
  if (offlineData.length === 0) return;

  try {
      const response = await fetch('sync_data.php', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify(offlineData)
      });
      const result = await response.json();
      if (result.success) {
          await clearOfflineData();
          console.log('Offline data synced successfully');
      } else {
          throw new Error('Sync failed');
      }
  } catch (error) {
      console.error('Error syncing offline data:', error);
  }
}






// Add a new message event listener to handle cache updates
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  } else if (event.data === 'clearCache') {
    console.log('Clearing cache...');
    clearCache();
  } else if (event.data === 'updateCache') {
    console.log('Cache update triggered via message');
    updateCache();
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
    return cache.addAll(urlsToCache).then(() => {
      console.log('Cache updated with new resources');

      // Now clear out old entries that are no longer needed
      return cache.keys().then((cacheKeys) => {
        const deletionPromises = cacheKeys.map((cacheKey) => {
          const requestUrl = new URL(cacheKey.url).pathname;
          return cache.match(cacheKey).then((cachedResponse) => {
            if (cachedResponse && cachedResponse.type === 'opaqueredirect') {
              console.log(`Deleting cached redirect entry: ${requestUrl}`);
              return cache.delete(cacheKey);
            }
            if (!urlsToCache.includes(requestUrl)) {
              console.log(`Deleting outdated cache entry: ${requestUrl}`);
              return cache.delete(cacheKey);
            }
          });
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