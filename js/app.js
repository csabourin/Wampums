// app.js

import { initializePointsUI, refreshPointsData, updatePointsDisplay } from './points_manager.js';
import { openDB, saveOfflineData, getOfflineData, clearOfflineData } from './indexedDB.js';

let newWorker;
let selectedItem = null;
let pendingUpdates = [];
let updateTimeout = null;

let cacheProgressContainer = document.getElementById(
  "cache-progress-container"
);
let cacheProgressBar = document.getElementById("cache-progress-bar");

navigator.serviceWorker.addEventListener("message", (event) => {
  if (event.data.type === "cacheProgress") {
    updateCacheProgress(event.data.progress);
  }
});

function updateCacheProgress(progress) {
  if (progress === 0) {
    cacheProgressContainer.style.display = "block";
  }
  cacheProgressBar.style.width = `${progress}%`;
  if (progress === 100) {
    setTimeout(() => {
      cacheProgressContainer.style.display = "none";
    }, 1000); // Hide after 1 second
  }
}

// When the page loads, check if it's a new service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/service-worker.js", { type: "module", scope: "/" })
    .then((registration) => {
      if (registration.installing) {
        cacheProgressContainer.style.display = "block";
      }
      console.log("Service Worker registered with scope:", registration.scope);

      registration.addEventListener("updatefound", () => {
        newWorker = registration.installing;
        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            showUpdateBar();
          }
        });
      });

      // Register for sync
      navigator.serviceWorker.ready.then((swRegistration) => {
        return swRegistration.sync.register("sync-points");
      });
    })
    .catch((error) => {
      console.log("Service Worker registration failed:", error);
    });
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
window.addEventListener("load", updateOnlineStatus);

navigator.serviceWorker.addEventListener("message", (event) => {
  if (event.data === "sync-data") {
    syncData();
  }
});

let isSyncing = false;
let syncTimeout;

function updateOnlineStatus() {
  const status = navigator.onLine ? "online" : "offline";
  console.log("Connection status:", status);
  document.body.classList.remove("online", "offline");
  document.body.classList.add(status);

  const offlineIndicator = document.getElementById("offline-indicator");
  if (offlineIndicator) {
    offlineIndicator.style.display = status === "offline" ? "block" : "none";
  }

  const manageLinks = document.querySelectorAll(
    ".manage-names, .manage-groups"
  );
  manageLinks.forEach((link) => {
    link.style.pointerEvents = status === "offline" ? "none" : "auto";
    link.style.opacity = status === "offline" ? "0.5" : "1";
  });

  if (status === "online") {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      clearCache();
      syncData();
    }, 1000); // Debounce time to avoid rapid consecutive syncs
  }
}

async function syncData() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const offlineData = await getOfflineData();

    if (offlineData.length === 0) {
      console.log("No offline data to sync");
      return;
    }

    const response = await fetch("/sync_data.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(offlineData),
    });

    if (!response.ok) {
      console.error("Network response was not ok", response);
      throw new Error("Network response was not ok");
    }

    // Check if response body is empty
    const text = await response.text();
    if (!text) {
      throw new Error("Empty response from server");
    }

    // Parse the JSON safely
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error("Error parsing JSON:", error);
      throw new Error("Invalid JSON response");
    }

    if (data && data.success) {
      await clearOfflineData();
      console.log("Data synced successfully");
      applyServerUpdates(data.serverUpdates || []);
    } else {
      console.error("Error syncing data:", data.message || "Unknown error");
      throw new Error(data.message || "Failed to sync data");
    }
  } catch (error) {
    console.error("Error syncing data:", error);
  } finally {
    isSyncing = false;
  }
}


function applyServerUpdates(updates) {
  updates.forEach((update) => {
    if (update.action === "updatePoints") {
      const { type, id, totalPoints, memberPoints } = update.data;
      if (type === "group") {
        updateGroupPoints(id, totalPoints, memberPoints);
      } else {
        updateIndividualPoints(id, totalPoints);
      }
    }
    // Add more cases for other types of updates as needed
  });
}

function showUpdateBar() {
  const updateBar = document.createElement("div");
  updateBar.textContent = translate("new_version_available");
  updateBar.style.cssText =
    "position: fixed; bottom: 0; left: 0; right: 0; background: #4c65ae; color: white; text-align: center; padding: 1em; cursor: pointer;";
  updateBar.addEventListener("click", () => {
    newWorker.postMessage({ action: "skipWaiting" });
    window.location.reload();
  });
  document.body.appendChild(updateBar);
}

function clearCache() {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage("updateCache");
  }
}

export async function fetchAndStoreAttendanceReport() {
  if (!navigator.onLine) {
    console.log("Cannot fetch attendance report while offline");
    return;
  }

  try {
    console.log("Fetching attendance report...");
    const response = await fetch("/generate_attendance_report.php");
    if (!response.ok) {
      throw new Error(
        `Failed to fetch attendance report: ${response.status} ${response.statusText}`
      );
    }
    const reportData = await response.json();
    console.log("Fetched report data:", reportData);

    const db = await openDB();
    const tx = db.transaction("offlineData", "readwrite");
    const store = tx.objectStore("offlineData");

    console.log("Clearing existing data...");
    await store.clear();

    console.log("Storing new report...");
    await store.put({
      action: "attendanceReport",
      data: reportData,
      timestamp: new Date().toISOString(),
    });

    await tx.complete;
    console.log("Attendance report stored offline");

    // Retrieve and log all stored data
    const allDataRequest = store.getAll();
    const allData = await new Promise((resolve) => {
      allDataRequest.onsuccess = () => resolve(allDataRequest.result);
    });
    console.log("All stored data:", allData);

    return reportData;
  } catch (error) {
    console.error("Error fetching and storing attendance report:", error);
    throw error;
  }
}

export async function fetchAndStoreHealthContactReport() {
  if (!navigator.onLine) {
    console.log("Cannot fetch health and contact report while offline");
    return;
  }

  try {
    console.log("Fetching health and contact report...");
    const response = await fetch("/generate_health_contact_report.php");
    if (!response.ok) {
      throw new Error(
        `Failed to fetch health and contact report: ${response.status} ${response.statusText}`
      );
    }
    const reportData = await response.json();
    console.log("Fetched health and contact data:", reportData);

    const db = await openDB();
    const tx = db.transaction("offlineData", "readwrite");
    const store = tx.objectStore("offlineData");

    await store.put({
      action: "healthContactReport",
      data: reportData,
      timestamp: new Date().toISOString(),
    });

    await tx.complete;
    console.log("Health and contact report stored offline");

    // Verify stored data
    const storedData = await store.get("healthContactReport");
    console.log("Verified stored health and contact report:", storedData);

    return reportData;
  } catch (error) {
    console.error(
      "Error fetching and storing health and contact report:",
      error
    );
    throw error;
  }
}

function fetchWithCacheBusting(url) {
  const bustCache = new URLSearchParams({ _: new Date().getTime() });
  const bustUrl = `${url}${url.includes("?") ? "&" : "?"}${bustCache}`;
  return fetch(bustUrl, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
}

// Add an event listener for when the user is about to leave the page
window.addEventListener("beforeunload", function (e) {
  if (pendingUpdates.length > 0) {
    // Attempt to send any pending updates
    sendBatchUpdate();

    // The following line is necessary for some browsers to show a warning dialog
    e.returnValue = "";
  }
});

// Translation function (placeholder - implement actual translation logic)
function translate(key) {
  // Implement your translation logic here
  return key;
}

// Initialize the page
document.addEventListener("DOMContentLoaded", function () {
  if (navigator.onLine) {
    refreshPointsData();
    fetchAndStoreAttendanceReport();
  }
});

// Refresh points data periodically when online
setInterval(() => {
  if (navigator.onLine) {
    refreshPointsData();
  }
}, 300000); // Refresh every 5 minutes

// Expose necessary functions to window object for use in HTML

window.fetchAndStoreAttendanceReport = fetchAndStoreAttendanceReport;
window.fetchAndStoreHealthContactReport = fetchAndStoreHealthContactReport;
