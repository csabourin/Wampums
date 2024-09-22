// Translation function
function translate(key) {
  // This should be implemented to return translations based on the current language
  // For now, we'll just return the key
  return key;
}

// Save offline data
function saveOfflineData(action, data) {
  const offlineData = JSON.parse(localStorage.getItem("offlineData")) || [];
  offlineData.push({ action, data });
  localStorage.setItem("offlineData", JSON.stringify(offlineData));
}

// Load offline data
function loadOfflineData() {
  return JSON.parse(localStorage.getItem("offlineData")) || [];
}

// Clear offline data
function clearOfflineData() {
  localStorage.removeItem("offlineData");
}

// Add offline indicator to an element
function addOfflineIndicator(element, points) {
  const indicator = document.createElement("span");
  indicator.textContent = points > 0 ? `+${points}` : points;
  indicator.className = "offline-indicator";
  element.appendChild(indicator);
}

// Remove all offline indicators
function removeOfflineIndicators() {
  document.querySelectorAll(".offline-indicator").forEach((indicator) => {
    indicator.remove();
  });
}

// Sync data with server
function syncData() {
  if (!navigator.onLine) {
    console.log("Cannot sync while offline");
    return;
  }

  const offlineData = loadOfflineData();

  if (offlineData.length === 0) {
    console.log("No offline data to sync");
    return;
  }

  fetch("/sync_data.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(offlineData),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        clearOfflineData();
        console.log("Data synced successfully");
        removeOfflineIndicators();
        // Refresh the page or update the UI as needed
        location.reload();
      } else {
        console.error("Error syncing data:", data.error);
        alert(translate("failed_to_sync_data"));
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      alert(translate("failed_to_sync_data"));
    });
}

// Fetch data with cache-busting
function fetchWithCacheBusting(url, options = {}) {
  const bustCache = new URLSearchParams({ _: new Date().getTime() });
  const bustUrl = `${url}${url.includes("?") ? "&" : "?"}${bustCache}`;

  return fetch(bustUrl, {
    ...options,
    headers: {
      ...options.headers,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
}
