import { debugLog, debugError, debugWarn } from "./utils/DebugUtils.js";

const DB_NAME = "WampumsAppDB";
const DB_VERSION = 12;
const STORE_NAME = "offlineData";

/**
 * Delete the IndexedDB database for the application.
 * Used on logout to ensure no cached data remains available across accounts.
 * @returns {Promise<void>} Resolves when the database is deleted
 */
export function deleteIndexedDB() {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

    deleteRequest.onsuccess = () => {
      debugLog("IndexedDB deleted successfully");
      resolve();
    };

    deleteRequest.onerror = () => {
      debugError("Error deleting IndexedDB:", deleteRequest.error);
      reject(deleteRequest.error);
    };

    deleteRequest.onblocked = () => {
      debugWarn("IndexedDB deletion blocked. Close other tabs using the app to complete cleanup.");
    };
  });
}

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      debugError("Error opening IndexedDB:", event.target.errorCode);
      reject(event.target.errorCode);
    };

    request.onsuccess = (event) => {
      debugLog("IndexedDB opened successfully");
      resolve(event.target.result);
    };

    request.onupgradeneeded = (event) => {
      debugLog("Upgrading IndexedDB...");
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("key_idx", "key", { unique: true });
        store.createIndex("type_idx", "type", { unique: false });
        store.createIndex("timestamp_idx", "timestamp", { unique: false });
      }
    };
  });
}

export function setCachedData(key, data, expirationTime = 2 * 60 * 60 * 1000) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      const record = {
        key: key,
        data: data,
        type: 'cache',
        timestamp: Date.now(),
        expiration: Date.now() + expirationTime
      };

      const request = store.put(record);

      request.onerror = () => {
        debugError("Error storing data:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        debugLog("Data stored successfully:", record);
        resolve(request.result);
      };

      tx.oncomplete = () => {
        db.close();
      };
    });
  });
}

export function getCachedData(key) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);

      const request = store.get(key);

      request.onerror = () => {
        debugError("Error retrieving data:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const record = request.result;
        debugLog(request," Retrieved record:", record);

        if (record && record.expiration > Date.now()) {
          debugLog("Returning valid cached data:", record.data);
          resolve(record.data);
        } else {
          if (!record) {
            debugLog("No data found for key:", key);
          } else {
            debugLog("Data expired for key:", key,Date.now(),` exp:`,record.expiration);
            const cleanupTx = db.transaction(STORE_NAME, "readwrite");
            const cleanupStore = cleanupTx.objectStore(STORE_NAME);
            cleanupStore.delete(key);
          }
          resolve(null);
        }
      };

      tx.oncomplete = () => {
        db.close();
      };
    });
  });
}

// Enhanced offline data handling
export async function saveOfflineData(action, data) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const record = {
        key: `${action}`,
        type: 'offline',
        action,
        data,
        timestamp: Date.now(),
        retryCount: 0
      };

      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  });
}

export async function getOfflineData() {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("type_idx");
      const request = index.getAll("offline");

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const offlineData = request.result || [];
        debugLog("Retrieved offline data:", offlineData);
        resolve(offlineData);
      };
    });
  });
}

export async function clearOfflineData() {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("type_idx");
      const request = index.getAll("offline");

      request.onsuccess = () => {
        const offlineRecords = request.result || [];
        offlineRecords.forEach(record => {
          store.delete(record.key);
        });
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  });
}

export async function deleteCachedData(key) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => {
        debugError("Error deleting cached data:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        debugLog("Cache deleted for key:", key);
        resolve();
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  });
}

export async function clearPointsRelatedCaches() {
  const keysToDelete = [
    'participants',
    'manage_points_data',
    'dashboard_groups',
    'dashboard_participant_info'
  ];

  debugLog("Clearing points-related caches:", keysToDelete);

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

export async function clearGroupRelatedCaches() {
  const keysToDelete = [
    'groups',
    'participants',
    'participants_v2', // Clear new versioned cache
    'manage_points_data',
    'dashboard_groups',
    'dashboard_participant_info'
  ];

  debugLog("Clearing group-related caches:", keysToDelete);

  // Also clear attendance caches that contain group information
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const allKeys = await new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // Delete attendance caches which contain group_id
  for (const key of allKeys) {
    if (key.startsWith('attendance_')) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

export async function clearBadgeRelatedCaches() {
  const keysToDelete = [
    'badge_dashboard_badges',
    'badge_dashboard_participants',
    'badge_dashboard_groups',
    'badge_summary',         // API-level cache used by getBadgeSummary()
    'participants'           // API-level cache used by getParticipants()
  ];

  debugLog("Clearing badge-related caches:", keysToDelete);

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

export async function clearFundraiserRelatedCaches(fundraiserId = null) {
  const baseKeys = new Set(['fundraisers']);
  if (fundraiserId) {
    baseKeys.add(`calendars_${fundraiserId}`);
  }

  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const allKeys = await new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  allKeys.forEach(key => {
    if (key.startsWith('fundraisers')) {
      baseKeys.add(key);
    }

    if (key.startsWith('calendars_')) {
      if (!fundraiserId || key === `calendars_${fundraiserId}`) {
        baseKeys.add(key);
      }
    }
  });

  debugLog("Clearing fundraiser-related caches:", Array.from(baseKeys));

  for (const key of baseKeys) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

export async function clearFinanceRelatedCaches(participantFeeId = null) {
  const baseKeys = new Set([
    'participant_fees',
    'finance_report'
  ]);

  if (participantFeeId) {
    baseKeys.add(`participant_fee_payments_${participantFeeId}`);
    baseKeys.add(`payment_plans_${participantFeeId}`);
  }

  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const allKeys = await new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  allKeys.forEach(key => {
    if (key.startsWith('participant_fee_payments_')) {
      if (!participantFeeId || key === `participant_fee_payments_${participantFeeId}`) {
        baseKeys.add(key);
      }
    }
    if (key.startsWith('payment_plans_')) {
      if (!participantFeeId || key === `payment_plans_${participantFeeId}`) {
        baseKeys.add(key);
      }
    }
  });

  debugLog("Clearing finance-related caches:", Array.from(baseKeys));

  for (const key of baseKeys) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

/**
 * Clear cached external revenue data to avoid stale finance dashboards.
 * Deletes the main list cache and any summary caches scoped by date.
 * @returns {Promise<void>} Resolves when the caches have been removed
 */
export async function clearExternalRevenueCaches() {
  const keysToDelete = new Set(['external_revenue']);

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const allKeys = await new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    allKeys.forEach((key) => {
      if (typeof key === "string" && key.startsWith("external_revenue_summary_")) {
        keysToDelete.add(key);
      }
    });
  } catch (error) {
    debugWarn("Unable to enumerate external revenue caches for cleanup:", error);
  }

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

/**
 * Clear activity-related caches
 * Call this after creating, updating, or deleting activities
 */
export async function clearActivityRelatedCaches() {
  const keysToDelete = [
    'activities',
    'upcoming_activities',
    'v1/activities', // API v1 endpoint cache
  ];

  // Also clear any activity-specific caches
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const allKeys = await new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // Find and clear activity-specific caches (e.g., 'activity_123', 'carpool_offers_123', 'v1/activities/123')
  allKeys.forEach(key => {
    if (typeof key === 'string' && (
      key.startsWith('activity_') ||
      key.startsWith('carpool_') ||
      key.startsWith('v1/activities/') ||
      key.startsWith('v1/carpools/')
    )) {
      keysToDelete.push(key);
    }
  });

  debugLog("Clearing activity-related caches:", keysToDelete);

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

/**
 * Clear carpool-related caches
 * Call this after creating, updating, or deleting carpool offers or assignments
 * @param {number} activityId - Optional activity ID to clear specific activity caches
 */
export async function clearCarpoolRelatedCaches(activityId = null) {
  const keysToDelete = [
    'v1/carpools/my-offers',
    'v1/carpools/my-children-assignments',
  ];

  // If activityId is provided, clear activity-specific caches
  if (activityId) {
    keysToDelete.push(`v1/carpools/activity/${activityId}`);
    keysToDelete.push(`v1/carpools/activity/${activityId}/unassigned`);
    keysToDelete.push(`v1/activities/${activityId}`);
    keysToDelete.push(`v1/activities/${activityId}/participants`);
  } else {
    // Clear all carpool caches
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const allKeys = await new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Find and clear all carpool-specific caches
    allKeys.forEach(key => {
      if (typeof key === 'string' && key.startsWith('v1/carpools/')) {
        keysToDelete.push(key);
      }
    });
  }

  debugLog("Clearing carpool-related caches:", keysToDelete);

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

// Function to sync offline data with retry mechanism
export async function syncOfflineData() {
  if (!navigator.onLine) {
    debugLog("Device is offline, cannot sync");
    return;
  }

  try {
    const offlineData = await getOfflineData();
    debugLog("Found offline data to sync:", offlineData);

    for (const item of offlineData) {
      try {
        switch (item.action) {
          case 'updateAttendance':
            await updateAttendance(
              item.data.participantIds,
              item.data.newStatus,
              item.data.date
            );
            break;

          case 'saveParticipant':
            await saveParticipant(item.data);
            break;

          case 'saveGuest':
            await saveGuest(item.data);
            break;

          // Add other cases as needed
          default:
            debugWarn(`Unknown offline action type: ${item.action}`);
        }

        // If successful, remove the item from offline storage
        await openDB().then(db => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          return store.delete(item.key);
        });

      } catch (error) {
        debugError(`Error syncing offline data for action ${item.action}:`, error);

        // Increment retry count and update the record
        if (item.retryCount < 3) {
          await openDB().then(db => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            item.retryCount = (item.retryCount || 0) + 1;
            return store.put(item);
          });
        }
      }
    }
  } catch (error) {
    debugError("Error during offline data sync:", error);
    throw error;
  }
}
