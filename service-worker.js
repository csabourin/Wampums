const CACHE_NAME = "wampums-app-v5.0";
const STATIC_CACHE_NAME = "wampums-static-v5.0";
const API_CACHE_NAME = "wampums-api-v5.0";
const IMAGE_CACHE_NAME = "wampums-images-v5.0"; 

const staticAssets = [
  "/",
  "/index.html",
  "/offline.html",
  "/css/styles.css",
  "/spa/app.js",
  "/spa/dashboard.js",
  "/spa/parent_dashboard.js",
  "/spa/manage_points.js",
  "/spa/attendance.js",
  "/spa/indexedDB.js",
  "/spa/ajax-functions.js",
  "/manifest.json",
];

const staticImages = [
  "/images/icon-192x192.png",
  "/images/icon-512x512.png",
  "/images/6eASt-Paul.png",
];

const apiRoutes = [
  "/api?action=get_attendance_dates",
  "/api?action=get_participants",
  "/api?action=get_participants_with_users",
  "/api?action=get_parent_users",
  "/api?action=get_parent_contact_list",
  "/api?action=get_groups",
  "/api/translations",
  "/api?action=get_mailing_list"
];

const offlinePages = [
  "/manage_users_participants",
  "/approve_badges",
  "/manage_groups",
];

// Install event: cache static assets
self.addEventListener("install", (event) => {
  self.skipWaiting(); // Forces the service worker to activate immediately after installation
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(staticAssets)),
    // Cache images separately
    caches.open(IMAGE_CACHE_NAME)
      .then(cache => cache.addAll(staticImages))
  );
});

// Install event: cache static assets and images separately
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_CACHE_NAME)
        .then(cache => cache.addAll(staticAssets)),
      // Cache images separately
      caches.open(IMAGE_CACHE_NAME)
        .then(cache => cache.addAll(staticImages))
    ])
  );
});

// Activate event with improved cache cleanup
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (![CACHE_NAME, STATIC_CACHE_NAME, API_CACHE_NAME, IMAGE_CACHE_NAME].includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Enhanced fetch event handler with specific image handling
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }

  // Special handling for images
  if (event.request.destination === 'image' || staticImages.includes(url.pathname)) {
    event.respondWith(handleImageRequest(event.request));
    return;
  }

  if (event.request.method === "GET") {
    if (apiRoutes.some((route) => url.pathname.includes(route))) {
      event.respondWith(fetchAndCacheInIndexedDB(event.request));
    } else if (staticAssets.includes(url.pathname)) {
      event.respondWith(cacheFirst(event.request));
    } else {
      event.respondWith(networkFirst(event.request));
    }
  } else {
    event.respondWith(fetch(event.request));
  }
});

// Specialized image handling function
async function handleImageRequest(request) {
  // Try cache first for images
  const cachedResponse = await caches.match(request, {
    cacheName: IMAGE_CACHE_NAME
  });

  if (cachedResponse) {
    // If found in cache, return immediately
    return cachedResponse;
  }

  // If not in cache, fetch from network
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.error('Error fetching image:', error);
    // Return a fallback image if available
    return caches.match('/images/fallback.png') || new Response('Image not available', { status: 404 });
  }
}

// Modified cache-first strategy with improved error handling
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('Cache-first strategy error:', error);
    return new Response('Resource not available', { status: 404 });
  }
}

self.addEventListener('push', function(event) {
  let data = {};

  // Check if there is any data in the push event and log it
  if (event.data) {
    try {
      data = event.data.json(); // Assuming the payload is JSON
      console.log("Push event data received:", data);
    } catch (e) {
      console.error('Error parsing push notification data:', e);
    }
  }

  const title = data.title || 'New Notification';
  const options = {
    body: data.body || 'You have a new message.',
    icon: data.icon || '/images/icon-192x192.png', // Optional: Add an icon for the notification
    badge: '/images/badge-128x128.png', // Optional: Add a badge image for Android
    tag: data.tag || 'general', // Optional: Unique tag for the notification (e.g., for stacking)
  };

  // Display the notification
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});


// Handle notification click event
self.addEventListener('notificationclick', function(event) {
  event.notification.close(); // Close the notification when clicked

  const notificationData = event.notification.data;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        // If a window with the same URL is already open, focus on it
        if (client.url === notificationData.url && 'focus' in client) {
          return client.focus();
        }
      }
      // If no window is open with the URL, open a new one
      if (clients.openWindow) {
        return clients.openWindow(notificationData.url);
      }
    })
  );
});



// // Fetch event: handle requests
// self.addEventListener("fetch", (event) => {
//   const url = new URL(event.request.url);

//   // Skip requests with unsupported schemes
//   if (url.protocol !== "http:" && url.protocol !== "https:") {
//     return; // Exit early for unsupported schemes
//   }

//   // Only handle GET requests for caching
//   if (event.request.method === "GET") {
//     // Handle offline-only pages
//     if (offlinePages.includes(url.pathname) && !navigator.onLine) {
//       event.respondWith(caches.match("/offline.html"));
//       return;
//     }

//     // Check for API routes to cache in IndexedDB
//     if (apiRoutes.some((route) => url.pathname.includes(route))) {
//       event.respondWith(fetchAndCacheInIndexedDB(event.request));
//     } 
//     // Serve static assets from cache
//     else if (staticAssets.includes(url.pathname)) {
//       event.respondWith(cacheFirst(event.request));
//     } 
//     // Default to network-first for all other requests
//     else {
//       event.respondWith(networkFirst(event.request));
//     }
//   } else {
//     // If it's not a GET request, do network-first without caching
//     event.respondWith(fetch(event.request));
//   }
// });



// Cache-first strategy for static assets
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

// Network-first strategy for dynamic API requests
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && request.method !== "POST") {
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

async function fetchAndCacheInIndexedDB(request) {
  const cacheKey = request.url; // Use the request URL as the cache key

  try {
    // First, check if the data exists in IndexedDB
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      return new Response(JSON.stringify(cachedData));
    }

    // If not in IndexedDB, try to fetch from the network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const responseClone = networkResponse.clone();
      const data = await networkResponse.json();

      // Save the response data in IndexedDB
      await setCachedData(cacheKey, data.data, 24 * 60 * 60 * 1000); // Cache for 24 hours
      return new Response(JSON.stringify(data)); // Return the response
    }
  } catch (error) {
    console.error("Network request failed, serving from cache:", error);
    // If the network fails, and no cache exists, return fallback error
    const fallbackResponse = await caches.match("/offline.html");
    if (fallbackResponse) return fallbackResponse;
  }

  // Return fallback if nothing is available
  return new Response(JSON.stringify({ error: "No data available" }), { status: 503 });
}


// Handle cache updates
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting(); // Immediately activate new service worker
  }
});

// Sync event for background syncing
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-data") {
    event.waitUntil(syncData());
  }
});

// Force reload on update
self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim().then(() => {
      return self.clients.matchAll({ type: "window" }).then((clients) => {
        console.log("Clients:", clients);
        // clients.forEach((client) => client.navigate(client.url)); // Reload all open pages
      });
    })
  );
});

const DB_NAME = 'wampums-cache';
const DB_VERSION = 1;
const STORE_NAME = 'api-cache';

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
    expiration: Date.now() + expirationTime, // Cache expiration time
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
        resolve(result.data); // Return data if not expired
      } else {
        resolve(null); // Return null if data is expired or not found
      }
    };
  });
}


async function syncData() {
  try {
    const offlineData = await getOfflineData();
    if (offlineData.length > 0) {
      for (let item of offlineData) {
        // Implement sync logic for each item
        console.log("Syncing item:", item);
        const response = await fetch("/api?action=" + item.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(item.data),
        });

        if (response.ok) {
          await clearOfflineData(item.id); // Clear after successful sync
        } else {
          console.error("Failed to sync item:", item, response.statusText);
        }
      }
      console.log("All data synced successfully");
    }
  } catch (error) {
    console.error("Error during data sync:", error);
  }
}
