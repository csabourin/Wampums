jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  DisconnectReason: {},
  fetchLatestBaileysVersion: jest.fn(() => Promise.resolve({ version: [2, 0, 0], isLatest: true })),
  makeCacheableSignalKeyStore: jest.fn(() => ({})),
  useMultiFileAuthState: jest.fn(() => Promise.resolve({ state: {}, saveCreds: jest.fn() }))
}));

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
