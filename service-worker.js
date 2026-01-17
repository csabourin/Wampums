// Version should match package.json and config.js
const APP_VERSION = "2.7.3";
const CACHE_NAME = `wampums-app-v${APP_VERSION}`;
const STATIC_CACHE_NAME = `wampums-static-v${APP_VERSION}`;
const API_CACHE_NAME = `wampums-api-v${APP_VERSION}`;
const IMAGE_CACHE_NAME = `wampums-images-v${APP_VERSION}`;

// Debug helpers for service worker (production domains end with .app)
const isProduction = () => {
  try {
    return self.location?.hostname?.endsWith(".app") || false;
  } catch (e) {
    return false;
  }
};
const debugLog = (...args) => {
  if (!isProduction()) console.log(...args);
};
const debugError = (...args) => {
  console.error(...args);
}; // Always show errors, even in production
const debugWarn = (...args) => {
  if (!isProduction()) console.warn(...args);
};
const debugInfo = (...args) => {
  if (!isProduction()) console.info(...args);
};

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
  "/spa/api/api-core.js",
  "/spa/api/api-endpoints.js",
  "/spa/api/api-helpers.js",
  // Note: config.js is NOT cached here - it should always be network-first to get latest version
  "/manifest.json",
];

const staticImages = [
  "/assets/images/icon-192x192.png",
  "/assets/images/icon-512x512.png",
  "/assets/images/6eASt-Paul.png",
];

// Font Awesome CDN resources for caching
const fontAwesomeResources = [
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/solid.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/fontawesome.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2",
];

// Requests that should never be cached to avoid stale metadata breaking updates
const nonCacheablePaths = new Set([
  "/service-worker.js",
  "/config.js",
  "/package.json",
  "/package-lock.json",
]);

// Updated API routes using the new endpoint structure
const apiRoutes = [
  "/api/attendance-dates",
  "/api/participants",
  "/api/v1/participants",
  "/api/participants-with-users",
  "/api/parent-users",
  "/api/parent-contact-list",
  "/api/groups",
  "/api/v1/groups",
  "/api/translations",
  "/api/mailing-list",
  "/api/attendance",
  "/api/v1/attendance",
  "/api/initial-data",
  "/api/organization-settings",
  "/api/honors",
  "/api/points-report",
  "/api/badge-summary",
  "/public/get_organization_id",
  "/public/organization-settings",
  "/public/initial-data",
  "/public/get_news",
];

const offlinePages = [
  "/manage_users_participants",
  "/approve_badges",
  "/manage_groups",
];

// Install event: cache static assets and images
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        self.skipWaiting(); // Forces the service worker to activate immediately after installation
        await Promise.all([
          caches
            .open(STATIC_CACHE_NAME)
            .then((cache) => cache.addAll(staticAssets)),
          caches
            .open(IMAGE_CACHE_NAME)
            .then((cache) => cache.addAll(staticImages)),
        ]);
      } catch (error) {
        debugError("Service worker install failed", error);
      }
    })(),
  );
});

// Activate event with improved cache cleanup
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (
            ![
              CACHE_NAME,
              STATIC_CACHE_NAME,
              API_CACHE_NAME,
              IMAGE_CACHE_NAME,
            ].includes(cacheName)
          ) {
            return caches.delete(cacheName);
          }
        }),
      );

      await purgeNonCacheableCacheEntries();
      await self.clients.claim();
    })(),
  );
});

// Enhanced fetch event handler with specific image handling
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }

  if (nonCacheablePaths.has(url.pathname)) {
    event.respondWith(fetchNonCacheable(event.request));
    return;
  }

  // Handle Font Awesome CDN resources (cache-first for fast icon loading)
  if (
    url.hostname === "cdnjs.cloudflare.com" &&
    url.pathname.includes("font-awesome")
  ) {
    event.respondWith(handleFontAwesomeRequest(event.request));
    return;
  }

  // Special handling for images
  if (
    event.request.destination === "image" ||
    staticImages.includes(url.pathname)
  ) {
    // Don't intercept Supabase storage images - let them pass through
    // This prevents CORS issues when different subdomains access shared images
    if (url.hostname.includes("supabase.co")) {
      return; // Let the browser handle Supabase images directly
    }
    event.respondWith(handleImageRequest(event.request));
    return;
  }

  if (event.request.method === "GET") {
    // Check if this is an API route
    const isApiRoute = apiRoutes.some(
      (route) =>
        url.pathname === route ||
        url.pathname.startsWith(route + "/") ||
        url.pathname.startsWith(route + "?"),
    );

    if (isApiRoute) {
      event.respondWith(fetchAndCacheInIndexedDB(event.request));
    } else if (staticAssets.includes(url.pathname)) {
      event.respondWith(cacheFirst(event.request));
    } else {
      event.respondWith(networkFirst(event.request));
    }
  } else if (
    event.request.method === "POST" ||
    event.request.method === "PUT" ||
    event.request.method === "DELETE"
  ) {
    // Handle mutations - try network first, queue for sync if offline
    event.respondWith(handleMutation(event.request));
  } else {
    event.respondWith(fetch(event.request));
  }
});

/**
 * Always fetch a fresh copy for non-cacheable assets to avoid stale service worker
 * or configuration metadata interfering with updates.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function fetchNonCacheable(request) {
  await purgeNonCacheableEntries(request);
  return fetch(request, { cache: "no-store" });
}

/**
 * Handle Font Awesome CDN requests with cache-first strategy.
 * Caches CSS and font files for fast icon loading on subsequent visits.
 */
async function handleFontAwesomeRequest(request) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    debugLog("Font Awesome resource served from cache:", request.url);
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Clone and cache the response
      cache.put(request, networkResponse.clone());
      debugLog("Font Awesome resource cached:", request.url);
    }
    return networkResponse;
  } catch (error) {
    debugError("Failed to fetch Font Awesome resource:", error);
    return new Response("Font resource not available", { status: 404 });
  }
}

// Specialized image handling function
async function handleImageRequest(request) {
  // Try cache first for images
  const cachedResponse = await caches.match(request, {
    cacheName: IMAGE_CACHE_NAME,
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
    // If response is not OK (4xx, 5xx), return fallback
    debugError("Image fetch returned non-OK status:", networkResponse.status);
    return (
      (await caches.match("/assets/images/fallback.png")) ||
      new Response("Image not available", { status: 404 })
    );
  } catch (error) {
    debugError("Error fetching image:", error);
    // Return a fallback image if available
    return (
      (await caches.match("/assets/images/fallback.png")) ||
      new Response("Image not available", { status: 404 })
    );
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
    debugError("Cache-first strategy error:", error);
    return new Response("Resource not available", { status: 404 });
  }
}

self.addEventListener("push", function (event) {
  let data = {};

  // Check if there is any data in the push event and log it
  if (event.data) {
    try {
      data = event.data.json(); // Assuming the payload is JSON
      debugLog("Push event data received:", data);
    } catch (e) {
      debugError("Error parsing push notification data:", e);
    }
  }

  const title = data.title || "New Notification";
  const options = {
    body: data.body || "You have a new message.",
    icon: data.icon || "/assets/images/icon-192x192.png", // Optional: Add an icon for the notification
    badge: "/assets/images/badge-128x128.png", // Optional: Add a badge image for Android
    tag: data.tag || "general", // Optional: Unique tag for the notification (e.g., for stacking)
  };

  // Display the notification
  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click event
self.addEventListener("notificationclick", function (event) {
  event.notification.close(); // Close the notification when clicked

  const notificationData = event.notification.data;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          // If a window with the same URL is already open, focus on it
          if (client.url === notificationData.url && "focus" in client) {
            return client.focus();
          }
        }
        // If no window is open with the URL, open a new one
        if (clients.openWindow) {
          return clients.openWindow(notificationData.url);
        }
      }),
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
    // Try network first for API requests to get fresh data
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const responseClone = networkResponse.clone();
      const data = await networkResponse.json();

      // Save the response data in IndexedDB for offline access
      await setCachedData(cacheKey, data, 24 * 60 * 60 * 1000); // Cache for 24 hours
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      }); // Return the response
    }

    // If the network responded with an error status, try a cached copy before failing
    debugWarn("API responded with", networkResponse.status, "for", cacheKey);
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      debugLog("Serving cached data after network error:", cacheKey);
      return new Response(JSON.stringify(cachedData), {
        headers: { "Content-Type": "application/json", "X-From-Cache": "true" },
      });
    }

    return networkResponse;
  } catch (error) {
    debugError(
      "Network request failed, attempting to serve from cache:",
      error,
    );

    // If network fails, check if the data exists in IndexedDB
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      debugLog("Serving from cache:", cacheKey);
      return new Response(JSON.stringify(cachedData), {
        headers: { "Content-Type": "application/json", "X-From-Cache": "true" },
      });
    }

    // If no cache exists, return error response
    return new Response(
      JSON.stringify({
        success: false,
        error: "No data available - offline and no cached data",
        offline: true,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Remove any cached entry that matches the provided request URL when it should
 * always be fetched from the network.
 *
 * @param {Request} request
 */
async function purgeNonCacheableEntries(request) {
  const pathname = new URL(request.url).pathname;
  const cacheNames = await caches.keys();

  await Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const cachedRequests = await cache.keys();

      await Promise.all(
        cachedRequests
          .filter((cachedRequest) => {
            try {
              return new URL(cachedRequest.url).pathname === pathname;
            } catch (error) {
              debugWarn("Skipping malformed cache key", error);
              return false;
            }
          })
          .map((cachedRequest) => cache.delete(cachedRequest)),
      );
    }),
  );
}

/**
 * Remove stale copies of assets that must always be fetched fresh.
 */
async function purgeNonCacheableCacheEntries() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((cachedRequest) => {
            try {
              return nonCacheablePaths.has(new URL(cachedRequest.url).pathname);
            } catch (error) {
              debugWarn("Skipping malformed cache key", error);
              return false;
            }
          })
          .map((cachedRequest) => cache.delete(cachedRequest)),
      );
    }),
  );
}

// Handle mutation requests (POST, PUT, DELETE)
async function handleMutation(request) {
  try {
    // Try to execute the mutation
    const response = await fetch(request);

    if (response.ok) {
      // If successful, clear relevant caches
      await invalidateRelatedCaches(request);
      return response;
    }

    return response;
  } catch (error) {
    debugError("Mutation failed, saving for background sync:", error);

    // If offline, save the request for background sync
    try {
      const requestData = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries([...request.headers.entries()]),
        body: request.method !== "GET" ? await request.clone().text() : null,
        timestamp: Date.now(),
      };

      await saveOfflineMutation(requestData);

      // Register for background sync
      if ("sync" in self.registration) {
        await self.registration.sync.register("sync-mutations");
      }

      // Return a response indicating the operation was queued
      return new Response(
        JSON.stringify({
          success: true,
          queued: true,
          message: "Request queued for sync when online",
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (saveError) {
      debugError("Failed to save mutation for sync:", saveError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to queue request for sync",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }
}

// Invalidate caches related to a mutation
async function invalidateRelatedCaches(request) {
  const url = new URL(request.url);
  const db = await openIndexedDB();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  // Get all keys from IndexedDB
  const allKeys = await new Promise((resolve) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });

  // Invalidate related caches based on the endpoint
  const keysToInvalidate = allKeys.filter((key) => {
    if (url.pathname.includes("/participants"))
      return key.toString().includes("participants");
    if (url.pathname.includes("/groups"))
      return key.toString().includes("group");
    if (url.pathname.includes("/attendance"))
      return key.toString().includes("attendance");
    if (url.pathname.includes("/points"))
      return key.toString().includes("points");
    if (url.pathname.includes("/honors"))
      return key.toString().includes("honors");
    if (url.pathname.includes("/badges"))
      return key.toString().includes("badge");
    return false;
  });

  // Delete invalidated keys
  for (const key of keysToInvalidate) {
    try {
      await new Promise((resolve, reject) => {
        const deleteRequest = store.delete(key);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject();
      });
    } catch (error) {
      debugWarn("Failed to invalidate cache key:", key);
    }
  }
}

// Handle messages from clients
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting" || event.data.type === "SKIP_WAITING") {
    self.skipWaiting(); // Immediately activate new service worker
  } else if (event.data.type === "GET_VERSION") {
    // Send current version back to client
    event.ports[0].postMessage({
      type: "VERSION_INFO",
      version: APP_VERSION,
    });
  } else if (event.data.type === "CHECK_UPDATE") {
    // Check if a new service worker is waiting
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: "UPDATE_AVAILABLE",
          version: APP_VERSION,
        });
      });
    });
  }
});

// Sync event for background syncing
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-data" || event.tag === "sync-mutations") {
    event.waitUntil(syncData());
  }
});

// Force reload on update
self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim().then(() => {
      return self.clients.matchAll({ type: "window" }).then((clients) => {
        debugLog("Clients:", clients);
        // clients.forEach((client) => client.navigate(client.url)); // Reload all open pages
      });
    }),
  );
});

const DB_NAME = "wampums-cache";
const DB_VERSION = 2;
const STORE_NAME = "api-cache";
const MUTATION_STORE_NAME = "pending-mutations";

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create main cache store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "url" });
      }

      // Create mutations store for offline sync
      if (!db.objectStoreNames.contains(MUTATION_STORE_NAME)) {
        const mutationStore = db.createObjectStore(MUTATION_STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        mutationStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

async function setCachedData(key, data, expirationTime) {
  const db = await openIndexedDB();
  const transaction = db.transaction([STORE_NAME], "readwrite");
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
    const transaction = db.transaction([STORE_NAME], "readonly");
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

// Save offline mutation for background sync
async function saveOfflineMutation(mutationData) {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MUTATION_STORE_NAME], "readwrite");
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.add(mutationData);

    request.onerror = () => {
      debugError("Error saving offline mutation:", request.error);
      reject(request.error);
    };
    request.onsuccess = () => {
      debugLog("Offline mutation saved:", mutationData);
      resolve(request.result);
    };
  });
}

// Get all pending mutations
async function getPendingMutations() {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MUTATION_STORE_NAME], "readonly");
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

// Delete a pending mutation
async function deletePendingMutation(id) {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MUTATION_STORE_NAME], "readwrite");
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      debugLog("Deleted pending mutation:", id);
      resolve();
    };
  });
}

async function syncData() {
  if (!navigator.onLine) {
    debugLog("Device is offline, cannot sync");
    return;
  }

  try {
    // Sync pending mutations (new format)
    const pendingMutations = await getPendingMutations();
    debugLog(`Found ${pendingMutations.length} pending mutations to sync`);

    for (const mutation of pendingMutations) {
      try {
        debugLog("Syncing mutation:", mutation);

        // Reconstruct the request
        const response = await fetch(mutation.url, {
          method: mutation.method,
          headers: mutation.headers,
          body: mutation.body,
        });

        if (response.ok) {
          debugLog("Mutation synced successfully:", mutation.id);
          await deletePendingMutation(mutation.id);

          // Invalidate related caches
          const request = new Request(mutation.url, {
            method: mutation.method,
            headers: mutation.headers,
          });
          await invalidateRelatedCaches(request);
        } else {
          debugError(
            "Failed to sync mutation:",
            mutation.id,
            response.statusText,
          );

          // If it's a 4xx error (client error), delete the mutation as it won't succeed
          if (response.status >= 400 && response.status < 500) {
            debugLog("Client error, removing mutation:", mutation.id);
            await deletePendingMutation(mutation.id);
          }
        }
      } catch (error) {
        debugError("Error syncing mutation:", mutation.id, error);
        // Keep the mutation for next sync attempt
      }
    }

    // Also check for old format offline data (backward compatibility)
    try {
      const offlineData = await getOfflineData();
      if (offlineData && offlineData.length > 0) {
        debugLog(
          `Found ${offlineData.length} old format offline items to sync`,
        );
        for (let item of offlineData) {
          try {
            debugLog("Syncing old format item:", item);
            // Try to determine the new endpoint format
            const endpoint = item.action
              ? `/api/${item.action.replace("_", "-")}`
              : item.url;

            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(item.data),
            });

            if (response.ok) {
              await clearOfflineData(item.id);
            } else {
              debugError(
                "Failed to sync old format item:",
                item,
                response.statusText,
              );
            }
          } catch (error) {
            debugError("Error syncing old format item:", item, error);
          }
        }
      }
    } catch (error) {
      // Old format might not exist, that's okay
      debugLog("No old format offline data found");
    }

    debugLog("Sync completed");
  } catch (error) {
    debugError("Error during data sync:", error);
  }
}

// Get offline data (for backward compatibility with old format)
async function getOfflineData() {
  try {
    // Try to get from the WampumsAppDB (old format)
    return new Promise((resolve) => {
      const request = indexedDB.open("WampumsAppDB", 12);
      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("offlineData")) {
          resolve([]);
          return;
        }
        const transaction = db.transaction(["offlineData"], "readonly");
        const store = transaction.objectStore("offlineData");
        const index = store.index("type_idx");
        const getRequest = index.getAll("offline");

        getRequest.onsuccess = () => resolve(getRequest.result || []);
        getRequest.onerror = () => resolve([]);
      };
      request.onerror = () => resolve([]);
    });
  } catch (error) {
    debugError("Error getting offline data:", error);
    return [];
  }
}

// Clear offline data (for backward compatibility)
async function clearOfflineData(key) {
  try {
    return new Promise((resolve) => {
      const request = indexedDB.open("WampumsAppDB", 12);
      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("offlineData")) {
          resolve();
          return;
        }
        const transaction = db.transaction(["offlineData"], "readwrite");
        const store = transaction.objectStore("offlineData");
        const deleteRequest = store.delete(key);

        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve();
      };
      request.onerror = () => resolve();
    });
  } catch (error) {
    debugError("Error clearing offline data:", error);
  }
}
