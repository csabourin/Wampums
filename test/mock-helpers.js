/**
 * Mock Helper Functions
 * Provides setupDefaultMocks and mockQueryImplementation
 */
const { MockFactory } = require('./mock-factory');

let globalFactory = null;

/**
 * Get or create the global MockFactory instance
 * @returns {MockFactory} The factory instance
 */
function getFactory() {
  if (!globalFactory) {
    globalFactory = new MockFactory();
  }
  return globalFactory;
}

/**
 * The active scout year handed to any route that resolves one.
 *
 * Read endpoints are year-scoped, so almost every handler now asks for the
 * active year before running its own query. Generating that row from the schema
 * would produce arbitrary boundaries and a random status, which is exactly the
 * kind of detail every test would then have to stub for itself.
 */
const DEFAULT_SCOUT_YEAR = {
  id: 1,
  organization_id: 1,
  label: '2025-2026',
  start_date: '2025-09-01',
  end_date: '2026-08-31',
  status: 'active'
};

/**
 * Answer the scout year lookup, letting everything else fall through.
 *
 * @param {string} query - SQL being run
 * @returns {Object|undefined} Result when this is the year lookup
 */
function mockScoutYearQuery(query) {
  if (typeof query === 'string' && query.includes('FROM scout_years')) {
    return { rows: [{ ...DEFAULT_SCOUT_YEAR }] };
  }
  return undefined;
}

/**
 * Setup default mocks for all database queries
 * Uses schema-aware mock generation for all queries
 * 
 * @param {Object} __mClient - Mocked pg client
 * @param {Object} __mPool - Mocked pg pool
 * 
 * @example
 * ```javascript
 * const { __mClient, __mPool } = require('pg');
 * setupDefaultMocks(__mClient, __mPool);
 * ```
 */
function setupDefaultMocks(__mClient, __mPool) {
  const factory = getFactory();
  
  const handler = (query, params) => {
    return Promise.resolve(mockScoutYearQuery(query) || factory.mockQuery(query, params));
  };

  __mClient.query.mockImplementation(handler);
  __mPool.query.mockImplementation(handler);
}

/**
 * Setup custom mock implementation with fallback
 * Custom handler is tried first, then falls back to schema-based mocks
 * 
 * @param {Object} __mClient - Mocked pg client
 * @param {Object} __mPool - Mocked pg pool
 * @param {Function} customHandler - Custom query handler (query, params) => result
 * 
 * @example
 * ```javascript
 * const { __mClient, __mPool } = require('pg');
 * mockQueryImplementation(__mClient, __mPool, (query, params) => {
 *   if (query.includes('FROM users') && query.includes('status')) {
 *     return Promise.resolve({
 *       rows: [factory.mockTable('users', { status: 'pending' })]
 *     });
 *   }
 *   // Return undefined to trigger fallback to schema-based mock
 * });
 * ```
 */
function mockQueryImplementation(__mClient, __mPool, customHandler) {
  const factory = getFactory();
  
  const handler = async (query, params) => {
    // Try custom handler first (supports sync + async handlers)
    const customResult = await customHandler(query, params);
    if (customResult !== undefined && customResult !== null) {
      return customResult;
    }

    // Fall back to the scout year, then to the schema-based mock
    return mockScoutYearQuery(query) || factory.mockQuery(query, params);
  };
  
  __mClient.query.mockImplementation(handler);
  __mPool.query.mockImplementation(handler);
}

/**
 * Reset factory (useful for test isolation)
 * Creates a new factory instance with fresh ID counters
 * 
 * @example
 * ```javascript
 * beforeEach(() => {
 *   resetMockFactory();
 * });
 * ```
 */
function resetMockFactory() {
  globalFactory = null;
}

module.exports = {
  setupDefaultMocks,
  mockQueryImplementation,
  resetMockFactory,
  MockFactory,
  DEFAULT_SCOUT_YEAR
};
