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
  
  __mClient.query.mockImplementation((query, params) => {
    return Promise.resolve(factory.mockQuery(query, params));
  });
  
  __mPool.query.mockImplementation((query, params) => {
    return Promise.resolve(factory.mockQuery(query, params));
  });
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
  
  const handler = (query, params) => {
    // Try custom handler first
    const customResult = customHandler(query, params);
    if (customResult !== undefined && customResult !== null) {
      return customResult;
    }
    
    // Fall back to schema-based mock
    return Promise.resolve(factory.mockQuery(query, params));
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
  MockFactory 
};
