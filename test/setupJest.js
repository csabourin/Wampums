/**
 * Jest Setup File
 *
 * Loads before any tests run. Use for:
 * - Global mocks (e.g., @whiskeysockets/baileys, async-storage)
 * - Environment setup
 * - Conditional test helpers
 *
 * @see jest.config.js setupFilesAfterEnv
 */

// Conditional test helpers are available but not required for SPA tests
// Import only if needed: const { setupConditionalHelpers } = require('./jest-conditional-helpers');
// setupConditionalHelpers();

jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  DisconnectReason: {},
  fetchLatestBaileysVersion: jest.fn(() => Promise.resolve({ version: [2, 0, 0], isLatest: true })),
  makeCacheableSignalKeyStore: jest.fn(() => ({})),
  useMultiFileAuthState: jest.fn(() => Promise.resolve({ state: {}, saveCreds: jest.fn() }))
}), { virtual: true });

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = new Map();
  return {
    setItem: jest.fn(async (key, value) => {
      storage.set(key, value);
    }),
    getItem: jest.fn(async (key) => storage.get(key) ?? null),
    removeItem: jest.fn(async (key) => {
      storage.delete(key);
    }),
    getAllKeys: jest.fn(async () => Array.from(storage.keys())),
    multiRemove: jest.fn(async (keys) => {
      keys.forEach((key) => storage.delete(key));
    }),
    clear: jest.fn(() => {
      storage.clear();
    })
  };
}, { virtual: true });

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true }))
  }
}), { virtual: true });

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {}
    }
  }
}), { virtual: true });

global.__DEV__ = true;
