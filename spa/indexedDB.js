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
      debugWarn(
        "IndexedDB deletion blocked. Close other tabs using the app to complete cleanup.",
      );
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

export async function setCachedData(key, data, expirationTime = 2 * 60 * 60 * 1000) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const record = {
      key: key,
      data: data,
      type: "cache",
      timestamp: Date.now(),
      expiration: Date.now() + expirationTime,
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
}

export async function getCachedData(key) {
  const db = await openDB();

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
      debugLog(request, " Retrieved record:", record);

      if (record && record.expiration > Date.now()) {
        debugLog("Returning valid cached data:", record.data);
        resolve(record.data);
      } else {
        if (!record) {
          debugLog("No data found for key:", key);
        } else {
          debugLog(
            "Data expired for key:",
            key,
            Date.now(),
            ` exp:`,
            record.expiration,
          );
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
}

/**
 * Retrieve cached data ignoring expiration.
 * Used exclusively for offline fallback paths where stale data is
 * preferable to no data at all. Does not delete expired records.
 * @param {string} key - Cache key
 * @returns {Promise<*>} Cached data or null if not found
 */
export async function getCachedDataIgnoreExpiration(key) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    const request = store.get(key);

    request.onerror = () => {
      debugError("Error retrieving data (ignore expiration):", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const record = request.result;
      if (record) {
        debugLog("Returning cached data (ignoring expiration) for key:", key);
        resolve(record.data);
      } else {
        debugLog("No data found for key:", key);
        resolve(null);
      }
    };

    tx.oncomplete = () => {
      db.close();
    };
  });
}

// Enhanced offline data handling
export async function saveOfflineData(action, data, keyOverride = null) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const uniqueSuffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const recordKey = keyOverride || `${action}_${uniqueSuffix}`;

    const record = {
      key: recordKey,
      type: "offline",
      action,
      data,
      timestamp: Date.now(),
      retryCount: 0,
    };

    const request = store.put(record);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getOfflineData() {
  const db = await openDB();

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
}

export async function clearOfflineData() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("type_idx");
    const request = index.getAll("offline");

    request.onsuccess = () => {
      const offlineRecords = request.result || [];
      offlineRecords.forEach((record) => {
        store.delete(record.key);
      });
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

export async function deleteCachedData(key) {
  const db = await openDB();

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
}

export async function clearPointsRelatedCaches() {
  const keysToDelete = [
    "participants",
    "manage_points_data",
    "dashboard_groups",
    "dashboard_participant_info",
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
    "groups",
    "participants",
    "participants_v2", // Clear new versioned cache
    "manage_points_data",
    "dashboard_groups",
    "dashboard_participant_info",
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
    if (key.startsWith("attendance_")) {
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

/**
 * Clear participant-related caches
 * Call this after updates that affect participant data visibility.
 */
export async function clearBadgeRelatedCaches() {
  const keysToDelete = [
    "badge_dashboard_badges",
    "badge_dashboard_participants",
    "badge_dashboard_groups",
    "badge_summary", // API-level cache used by getBadgeSummary()
    "participants", // API-level cache used by getParticipants()
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
  const baseKeys = new Set(["fundraisers"]);
  if (fundraiserId) {
    baseKeys.add(`fundraiser_entries_${fundraiserId}`);
    // Also clear old calendar cache keys for backward compatibility
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

  allKeys.forEach((key) => {
    if (key.startsWith("fundraisers")) {
      baseKeys.add(key);
    }

    // Clear both old calendar_ and new fundraiser_entries_ cache keys
    if (key.startsWith("fundraiser_entries_")) {
      if (!fundraiserId || key === `fundraiser_entries_${fundraiserId}`) {
        baseKeys.add(key);
      }
    }
    if (key.startsWith("calendars_")) {
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
  const baseKeys = new Set(["participant_fees", "finance_report"]);

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

  allKeys.forEach((key) => {
    if (key.startsWith("participant_fee_payments_")) {
      if (
        !participantFeeId ||
        key === `participant_fee_payments_${participantFeeId}`
      ) {
        baseKeys.add(key);
      }
    }
    if (key.startsWith("payment_plans_")) {
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
  const keysToDelete = new Set(["external_revenue"]);

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
      if (
        typeof key === "string" &&
        key.startsWith("external_revenue_summary_")
      ) {
        keysToDelete.add(key);
      }
    });
  } catch (error) {
    debugWarn(
      "Unable to enumerate external revenue caches for cleanup:",
      error,
    );
  }

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

/* Clear all budget-related cache entries to avoid stale financial data after mutations.
 * @param {Object} [options] - Cache clearing options
 * @param {number|string|null} [options.categoryId=null] - Category identifier to clear category-specific item caches
 * @param {string|null} [options.fiscalYearStart=null] - Fiscal year start date used for summary/plans cache keys
 * @param {string|null} [options.fiscalYearEnd=null] - Fiscal year end date used for summary/plans cache keys
 * @returns {Promise<void>} Resolves when relevant caches are cleared
 */
export async function clearBudgetCaches({
  categoryId = null,
  fiscalYearStart = null,
  fiscalYearEnd = null,
} = {}) {
  const baseKeys = new Set([
    "budget_categories",
    "budget_items",
    "budget_expenses",
    "budget_plans",
  ]);

  if (categoryId) {
    baseKeys.add(`budget_items_cat_${categoryId}`);
  }

  if (fiscalYearStart && fiscalYearEnd) {
    baseKeys.add(`budget_summary_${fiscalYearStart}_${fiscalYearEnd}`);
    baseKeys.add(`budget_plans_${fiscalYearStart}_${fiscalYearEnd}`);
  }

  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const allKeys = await new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  allKeys.forEach((key) => {
    if (key.startsWith("budget_items")) {
      baseKeys.add(key);
    }
    if (key.startsWith("budget_revenue_")) {
      baseKeys.add(key);
    }
    if (key.startsWith("budget_summary_")) {
      baseKeys.add(key);
    }
    if (key.startsWith("budget_plans_")) {
      baseKeys.add(key);
    }
  });

  debugLog("Clearing budget-related caches:", Array.from(baseKeys));

  for (const key of baseKeys) {
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
    "activities",
    "upcoming_activities",
    "v1/activities", // API v1 endpoint cache
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
  allKeys.forEach((key) => {
    if (
      typeof key === "string" &&
      (key.startsWith("activity_") ||
        key.startsWith("carpool_") ||
        key.startsWith("v1/activities/") ||
        key.startsWith("v1/carpools/"))
    ) {
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
    "v1/carpools/my-offers",
    "v1/carpools/my-children-assignments",
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
    allKeys.forEach((key) => {
      if (typeof key === "string" && key.startsWith("v1/carpools/")) {
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

/**
 * Clear form-related caches
 * Call this after creating, updating, or deleting form formats or submissions
 * @param {string} formType - Optional form type to clear specific form caches
 * @param {number} organizationId - Optional organization ID to clear org-specific caches
 */
export async function clearFormRelatedCaches(formType = null, organizationId = null) {
  const keysToDelete = [
    "v1/form-types",
    "v1/forms/formats",
    "v1/form-formats",
  ];

  // If formType is provided, clear form-specific caches
  if (formType) {
    keysToDelete.push(`v1/form-structure?form_type=${formType}`);
    keysToDelete.push(`v1/form-submissions?form_type=${formType}`);
    keysToDelete.push(`v1/form-submissions-list?form_type=${formType}`);
  } else {
    // Clear all form caches
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const allKeys = await new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Find and clear all form-specific caches
    allKeys.forEach((key) => {
      if (
        typeof key === "string" &&
        (key.startsWith("v1/form-") ||
          key.includes("form_type=") ||
          key.includes("forms/formats"))
      ) {
        keysToDelete.push(key);
      }
    });
  }

  debugLog("Clearing form-related caches:", keysToDelete);

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

/**
 * Clear participant-related form caches
 * Call this after updating a specific participant's form submission
 * @param {number} participantId - Participant ID
 * @param {string} formType - Optional form type
 */
export async function clearParticipantFormCaches(participantId, formType = null) {
  const keysToDelete = [];

  if (formType) {
    keysToDelete.push(`v1/form-submission?participant_id=${participantId}&form_type=${formType}`);
  }

  // Clear all form submissions for this participant
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const allKeys = await new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // Find and clear participant-specific form caches
  allKeys.forEach((key) => {
    if (
      typeof key === "string" &&
      key.includes(`participant_id=${participantId}`)
    ) {
      keysToDelete.push(key);
    }
  });

  debugLog("Clearing participant form caches:", keysToDelete);

  for (const key of keysToDelete) {
    try {
      await deleteCachedData(key);
    } catch (error) {
      debugWarn(`Failed to delete cache for ${key}:`, error);
    }
  }
}

// syncOfflineData removed as it relied on undefined globals and is implemented in api-core.js
