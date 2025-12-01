/**
 * StorageUtils.js
 *
 * Centralized localStorage and sessionStorage utilities for the Wampums application.
 * Provides consistent error handling and JSON parsing/serialization.
 *
 * Usage:
 *   import { setStorage, getStorage, removeStorage } from './utils/StorageUtils.js';
 *   setStorage('myKey', { foo: 'bar' });
 *   const data = getStorage('myKey');
 */

import { debugError } from './DebugUtils.js';

/**
 * Get the appropriate storage object
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {Storage} Storage object
 */
function getStorageObject(isSession = false) {
    return isSession ? sessionStorage : localStorage;
}

/**
 * Set a value in storage
 * @param {string} key - Storage key
 * @param {any} value - Value to store (will be JSON-stringified if not a string)
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {boolean} True if successful
 */
export function setStorage(key, value, isSession = false) {
    try {
        const storage = getStorageObject(isSession);
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        storage.setItem(key, stringValue);
        return true;
    } catch (error) {
        debugError(`Error setting storage for key "${key}":`, error);
        return false;
    }
}

/**
 * Get a value from storage
 * @param {string} key - Storage key
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @param {any} defaultValue - Default value if key doesn't exist
 * @returns {any} Retrieved value or default value
 */
export function getStorage(key, isSession = false, defaultValue = null) {
    try {
        const storage = getStorageObject(isSession);
        const value = storage.getItem(key);
        return value !== null ? value : defaultValue;
    } catch (error) {
        debugError(`Error getting storage for key "${key}":`, error);
        return defaultValue;
    }
}

/**
 * Get a JSON value from storage and parse it
 * @param {string} key - Storage key
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @param {any} defaultValue - Default value if key doesn't exist or parse fails
 * @returns {any} Parsed value or default value
 */
export function getStorageJSON(key, isSession = false, defaultValue = null) {
    try {
        const storage = getStorageObject(isSession);
        const value = storage.getItem(key);

        if (value === null) {
            return defaultValue;
        }

        try {
            return JSON.parse(value);
        } catch (parseError) {
            debugError(`Error parsing JSON for key "${key}":`, parseError);
            return defaultValue;
        }
    } catch (error) {
        debugError(`Error getting storage JSON for key "${key}":`, error);
        return defaultValue;
    }
}

/**
 * Remove a value from storage
 * @param {string} key - Storage key
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {boolean} True if successful
 */
export function removeStorage(key, isSession = false) {
    try {
        const storage = getStorageObject(isSession);
        storage.removeItem(key);
        return true;
    } catch (error) {
        debugError(`Error removing storage for key "${key}":`, error);
        return false;
    }
}

/**
 * Clear all storage
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {boolean} True if successful
 */
export function clearStorage(isSession = false) {
    try {
        const storage = getStorageObject(isSession);
        storage.clear();
        return true;
    } catch (error) {
        debugError('Error clearing storage:', error);
        return false;
    }
}

/**
 * Check if a key exists in storage
 * @param {string} key - Storage key
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {boolean} True if key exists
 */
export function hasStorage(key, isSession = false) {
    try {
        const storage = getStorageObject(isSession);
        return storage.getItem(key) !== null;
    } catch (error) {
        debugError(`Error checking storage for key "${key}":`, error);
        return false;
    }
}

/**
 * Get all keys from storage
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {string[]} Array of storage keys
 */
export function getStorageKeys(isSession = false) {
    try {
        const storage = getStorageObject(isSession);
        return Object.keys(storage);
    } catch (error) {
        debugError('Error getting storage keys:', error);
        return [];
    }
}

/**
 * Get the size of storage in bytes (approximate)
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {number} Approximate size in bytes
 */
export function getStorageSize(isSession = false) {
    try {
        const storage = getStorageObject(isSession);
        let size = 0;

        for (let key in storage) {
            if (storage.hasOwnProperty(key)) {
                size += key.length + storage[key].length;
            }
        }

        return size;
    } catch (error) {
        debugError('Error getting storage size:', error);
        return 0;
    }
}

/**
 * Set a value in storage with expiration
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @param {number} expirationMs - Expiration time in milliseconds
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {boolean} True if successful
 */
export function setStorageWithExpiry(key, value, expirationMs, isSession = false) {
    try {
        const now = Date.now();
        const item = {
            value: value,
            expiry: now + expirationMs
        };
        return setStorage(key, item, isSession);
    } catch (error) {
        debugError(`Error setting storage with expiry for key "${key}":`, error);
        return false;
    }
}

/**
 * Get a value from storage with expiration check
 * @param {string} key - Storage key
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @param {any} defaultValue - Default value if key doesn't exist or is expired
 * @returns {any} Retrieved value or default value
 */
export function getStorageWithExpiry(key, isSession = false, defaultValue = null) {
    try {
        const itemStr = getStorage(key, isSession);
        if (!itemStr) {
            return defaultValue;
        }

        const item = JSON.parse(itemStr);
        const now = Date.now();

        if (now > item.expiry) {
            // Item has expired, remove it
            removeStorage(key, isSession);
            return defaultValue;
        }

        return item.value;
    } catch (error) {
        debugError(`Error getting storage with expiry for key "${key}":`, error);
        return defaultValue;
    }
}

/**
 * Set multiple values in storage at once
 * @param {Object} items - Object with key-value pairs
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {boolean} True if all successful
 */
export function setStorageMultiple(items, isSession = false) {
    try {
        let allSuccessful = true;
        for (const [key, value] of Object.entries(items)) {
            if (!setStorage(key, value, isSession)) {
                allSuccessful = false;
            }
        }
        return allSuccessful;
    } catch (error) {
        debugError('Error setting multiple storage items:', error);
        return false;
    }
}

/**
 * Get multiple values from storage at once
 * @param {string[]} keys - Array of storage keys
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {Object} Object with key-value pairs
 */
export function getStorageMultiple(keys, isSession = false) {
    const result = {};
    try {
        for (const key of keys) {
            result[key] = getStorage(key, isSession);
        }
        return result;
    } catch (error) {
        debugError('Error getting multiple storage items:', error);
        return result;
    }
}

/**
 * Remove multiple values from storage at once
 * @param {string[]} keys - Array of storage keys
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @returns {boolean} True if all successful
 */
export function removeStorageMultiple(keys, isSession = false) {
    try {
        let allSuccessful = true;
        for (const key of keys) {
            if (!removeStorage(key, isSession)) {
                allSuccessful = false;
            }
        }
        return allSuccessful;
    } catch (error) {
        debugError('Error removing multiple storage items:', error);
        return false;
    }
}

/**
 * Storage event listener wrapper
 * Listens for storage changes across tabs/windows
 * @param {Function} callback - Callback function (key, newValue, oldValue, url)
 * @returns {Function} Cleanup function to remove listener
 */
export function onStorageChange(callback) {
    const listener = (event) => {
        callback(event.key, event.newValue, event.oldValue, event.url);
    };

    window.addEventListener('storage', listener);

    // Return cleanup function
    return () => {
        window.removeEventListener('storage', listener);
    };
}

/**
 * Namespace prefix for storage keys
 * Helps avoid conflicts with other applications
 */
const DEFAULT_NAMESPACE = 'wampums';

/**
 * Create a namespaced storage key
 * @param {string} key - Original key
 * @param {string} namespace - Namespace prefix (defaults to 'wampums')
 * @returns {string} Namespaced key
 */
export function createNamespacedKey(key, namespace = DEFAULT_NAMESPACE) {
    return `${namespace}:${key}`;
}

/**
 * Set a namespaced value in storage
 * @param {string} key - Storage key (without namespace)
 * @param {any} value - Value to store
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @param {string} namespace - Namespace prefix
 * @returns {boolean} True if successful
 */
export function setNamespacedStorage(key, value, isSession = false, namespace = DEFAULT_NAMESPACE) {
    const namespacedKey = createNamespacedKey(key, namespace);
    return setStorage(namespacedKey, value, isSession);
}

/**
 * Get a namespaced value from storage
 * @param {string} key - Storage key (without namespace)
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @param {any} defaultValue - Default value if key doesn't exist
 * @param {string} namespace - Namespace prefix
 * @returns {any} Retrieved value or default value
 */
export function getNamespacedStorage(key, isSession = false, defaultValue = null, namespace = DEFAULT_NAMESPACE) {
    const namespacedKey = createNamespacedKey(key, namespace);
    return getStorage(namespacedKey, isSession, defaultValue);
}

/**
 * Remove a namespaced value from storage
 * @param {string} key - Storage key (without namespace)
 * @param {boolean} isSession - Use sessionStorage instead of localStorage
 * @param {string} namespace - Namespace prefix
 * @returns {boolean} True if successful
 */
export function removeNamespacedStorage(key, isSession = false, namespace = DEFAULT_NAMESPACE) {
    const namespacedKey = createNamespacedKey(key, namespace);
    return removeStorage(namespacedKey, isSession);
}
