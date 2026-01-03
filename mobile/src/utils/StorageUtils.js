/**
 * Storage Utilities for Wampums React Native App
 *
 * Mirrors spa/utils/StorageUtils.js functionality
 * Uses:
 * - SecureStore for small sensitive data (device tokens) on native platforms
 * - AsyncStorage for web platform, large tokens (JWT), and non-sensitive data
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import CONFIG from '../config';
import { debugError } from './DebugUtils.js';

// Keys that should be stored securely (on native platforms only)
// Note: JWT tokens are excluded because they often exceed SecureStore's 2048-byte limit
// and are already cryptographically signed (tamper-proof). Device tokens are small enough.
const SECURE_KEYS = [
  CONFIG.STORAGE_KEYS.DEVICE_TOKEN,
];

// Check if we should use SecureStore (only on native platforms)
const shouldUseSecureStore = (key) => {
  return Platform.OS !== 'web' && SECURE_KEYS.includes(key);
};

/**
 * Store a value securely or in async storage based on key sensitivity and platform
 */
export const setItem = async (key, value) => {
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    if (shouldUseSecureStore(key)) {
      await SecureStore.setItemAsync(key, stringValue);
    } else {
      await AsyncStorage.setItem(key, stringValue);
    }
    return true;
  } catch (error) {
    debugError(`Error storing ${key}:`, error);
    return false;
  }
};

/**
 * Retrieve a value from secure or async storage
 */
export const getItem = async (key) => {
  try {
    let value;

    if (shouldUseSecureStore(key)) {
      value = await SecureStore.getItemAsync(key);
    } else {
      value = await AsyncStorage.getItem(key);
    }

    if (!value) return null;

    // Try to parse as JSON, return as string if it fails
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    debugError(`Error retrieving ${key}:`, error);
    return null;
  }
};

/**
 * Remove a value from storage
 */
export const removeItem = async (key) => {
  try {
    if (shouldUseSecureStore(key)) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
    return true;
  } catch (error) {
    debugError(`Error removing ${key}:`, error);
    return false;
  }
};

/**
 * Store multiple key-value pairs
 * Mirrors spa/utils/StorageUtils.setStorageMultiple
 */
export const setStorageMultiple = async (items) => {
  try {
    const promises = Object.entries(items).map(([key, value]) =>
      setItem(key, value)
    );
    await Promise.all(promises);
    return true;
  } catch (error) {
    debugError('Error storing multiple items:', error);
    return false;
  }
};

/**
 * Retrieve multiple values from storage
 */
export const getStorageMultiple = async (keys) => {
  try {
    const promises = keys.map(async (key) => {
      const value = await getItem(key);
      return [key, value];
    });
    const results = await Promise.all(promises);
    return Object.fromEntries(results);
  } catch (error) {
    debugError('Error retrieving multiple items:', error);
    return {};
  }
};

/**
 * Clear user data while preserving device tokens and language preferences
 * Mirrors spa/utils/StorageUtils.clearUserData
 */
export const clearUserData = async () => {
  try {
    // Keys to preserve during logout
    const preserveKeys = [
      CONFIG.STORAGE_KEYS.DEVICE_TOKEN,
      CONFIG.STORAGE_KEYS.LANGUAGE,
      CONFIG.STORAGE_KEYS.WAMPUMS_LANG,
    ];

    // Get all keys
    const allKeys = await AsyncStorage.getAllKeys();

    // Filter out keys to preserve
    const keysToRemove = allKeys.filter((key) => !preserveKeys.includes(key));

    // Remove keys from AsyncStorage
    await AsyncStorage.multiRemove(keysToRemove);

    // Remove JWT token from storage (but preserve device_token)
    await removeItem(CONFIG.STORAGE_KEYS.JWT_TOKEN);

    return true;
  } catch (error) {
    debugError('Error clearing user data:', error);
    return false;
  }
};

/**
 * Clear all storage (use with caution)
 */
export const clearAllStorage = async () => {
  try {
    await AsyncStorage.clear();
    // Clear secure store items (only on native platforms)
    for (const key of SECURE_KEYS) {
      try {
        await removeItem(key);
      } catch (error) {
        // Key might not exist, ignore error
      }
    }
    return true;
  } catch (error) {
    debugError('Error clearing all storage:', error);
    return false;
  }
};

/**
 * JWT Token helpers
 */
export const setJWT = async (token) => {
  return await setItem(CONFIG.STORAGE_KEYS.JWT_TOKEN, token);
};

export const getJWT = async () => {
  return await getItem(CONFIG.STORAGE_KEYS.JWT_TOKEN);
};

export const clearJWT = async () => {
  return await removeItem(CONFIG.STORAGE_KEYS.JWT_TOKEN);
};

/**
 * Decode JWT token
 * Mirrors spa/jwt-helper.js decodeJWT
 */
export const decodeJWT = (token) => {
  try {
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const decoded = JSON.parse(
      decodeURIComponent(
        atob(payload)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
    );

    return decoded;
  } catch (error) {
    debugError('Error decoding JWT:', error);
    return null;
  }
};

/**
 * Check if JWT is expired
 */
export const isJWTExpired = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) return true;

  const expirationTime = decoded.exp * 1000; // Convert to milliseconds
  return Date.now() >= expirationTime;
};

/**
 * Get current user from JWT
 */
export const getCurrentUserFromJWT = async () => {
  try {
    const token = await getJWT();
    if (!token) return null;

    const decoded = decodeJWT(token);
    return decoded;
  } catch (error) {
    debugError('Error getting current user from JWT:', error);
    return null;
  }
};

/**
 * Get organization ID from JWT token
 * Mirrors backend getOrganizationId functionality
 */
export const getOrganizationId = async () => {
  try {
    const token = await getJWT();
    if (!token) return null;

    const decoded = decodeJWT(token);
    return decoded?.organizationId || null;
  } catch (error) {
    debugError('Error getting organization ID from JWT:', error);
    return null;
  }
};

export default {
  setItem,
  getItem,
  removeItem,
  setStorageMultiple,
  getStorageMultiple,
  clearUserData,
  clearAllStorage,
  setJWT,
  getJWT,
  clearJWT,
  decodeJWT,
  isJWTExpired,
  getCurrentUserFromJWT,
  getOrganizationId,
};
