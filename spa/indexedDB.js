const DB_NAME = "WampumsAppDB";
const DB_VERSION = 6; // Make sure the version is incremented correctly
const STORE_PARTICIPANTS = "participants";
const STORE_GROUPS = "groups";
const STORE_NAME = "offlineData"; // This store is for offline data

// Function to initialize the database and create object stores
export function initializeDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create object store for participants if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_PARTICIPANTS)) {
        db.createObjectStore(STORE_PARTICIPANTS, {
          keyPath: "id",
          autoIncrement: true,
        });
      }

      // Create object store for groups if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_GROUPS)) {
        db.createObjectStore(STORE_GROUPS, {
          keyPath: "id",
          autoIncrement: true,
        });
      }

      // Create object store for offline data if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
  });
}

// Simplified openDB function
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Save offline data function
export function saveOfflineData(action, data) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add({
        action,
        data,
        timestamp: new Date().toISOString(),
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  });
}

export function getOfflineData() {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // If the object store does not exist, throw an error or resolve with empty data
        console.error(`Object store "${STORE_NAME}" not found.`);
        return resolve([]); // Resolve with an empty array or handle as needed
      }

      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  });
}

// Clear offline data function
export function clearOfflineData() {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  });
}

// Save participants to IndexedDB
export function saveParticipants(participants) {
  return openDB().then((db) => {
    const transaction = db.transaction([STORE_PARTICIPANTS], "readwrite");
    const store = transaction.objectStore(STORE_PARTICIPANTS);
    store.clear(); // Clear old data before saving new data
    participants.forEach((participant, index) => {
      store.put({ id: index + 1, data: participant });
    });
    return transaction.complete;
  });
}

// Get participants from cache
export function getParticipantsFromCache() {
  return openDB().then((db) => {
    const transaction = db.transaction([STORE_PARTICIPANTS], "readonly");
    const store = transaction.objectStore(STORE_PARTICIPANTS);
    return store.getAll().then((result) => result.map((item) => item.data));
  });
}

// Save groups to IndexedDB
export function saveGroups(groups) {
  return openDB().then((db) => {
    const transaction = db.transaction([STORE_GROUPS], "readwrite");
    const store = transaction.objectStore(STORE_GROUPS);
    store.clear(); // Clear old data before saving new data
    groups.forEach((group, index) => {
      store.put({ id: index + 1, data: group });
    });
    return transaction.complete;
  });
}

// Get groups from cache
export function getGroupsFromCache() {
  return openDB().then((db) => {
    const transaction = db.transaction([STORE_GROUPS], "readonly");
    const store = transaction.objectStore(STORE_GROUPS);
    return store.getAll().then((result) => result.map((item) => item.data));
  });
}

export function setCachedData(key, data, expirationTime = 5 * 60 * 1000) {
  return openDB().then((db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    return store.put({
      key: key, // Save data with a specific key
      data: data,
      expiration: Date.now() + expirationTime, // Set expiration time
    });
  });
}

export function getCachedData(key) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.expiration > Date.now()) {
          resolve(result.data);
        } else {
          resolve(null); // Return null if data has expired or is not found
        }
      };
    });
  });
}
