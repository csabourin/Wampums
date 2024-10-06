const CACHE_NAME = "wampums-app-v3.7";
const STATIC_CACHE_NAME = "wampums-static-v3.7";
const API_CACHE_NAME = "wampums-api-v3.7";

const staticAssets = [
  "/",
  "/index.php",
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
  "/images/icon-192x192.png",
  "/images/icon-512x512.png",
  "/images/6eASt-Paul.png",
];

const apiRoutes = [
  "/api.php?action=get_attendance_dates",
  "/api.php?action=get_participants",
  "/api.php?action=get_participants_with_users",
  "/api.php?action=get_parent_users",
  "/api.php?action=get_parent_contact_list",
  "/api.php?action=get_groups",
  "/get_translations.php",
  "/api.php?action=get_mailing_list"
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
    caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(staticAssets))
  );
});

// Activate event: Clear old caches and take control of clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== CACHE_NAME &&
              cacheName !== STATIC_CACHE_NAME &&
              cacheName !== API_CACHE_NAME
            ) {
              return caches.delete(cacheName); // Delete old caches
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim(); // Take control of clients immediately
      })
  );
});

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



// Fetch event: handle requests
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip requests with unsupported schemes
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return; // Exit early for unsupported schemes
  }

  // Handle POST requests with network-first
  if (event.request.method === "POST") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Handle offline-only pages
  if (offlinePages.includes(url.pathname) && !navigator.onLine) {
    event.respondWith(caches.match("/offline.html"));
    return;
  }

  // Check for API routes to cache in IndexedDB
  if (apiRoutes.some((route) => url.pathname.includes(route))) {
    event.respondWith(fetchAndCacheInIndexedDB(event.request));
  } 
  // Serve static assets from cache
  else if (staticAssets.includes(url.pathname)) {
    event.respondWith(cacheFirst(event.request));
  } 
  // Default to network-first for all other requests
  else {
    event.respondWith(networkFirst(event.request));
  }
});


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
      await setCachedData(cacheKey, data, 24 * 60 * 60 * 1000); // Cache for 24 hours
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
        clients.forEach((client) => client.navigate(client.url)); // Reload all open pages
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
        const response = await fetch("/api.php?action=" + item.action, {
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
