/**
 * Centralized Mock Helpers for Database Tests
 * 
 * This module provides shared mock setup functions for database operations
 * across all test suites, ensuring consistent behavior and reducing duplication.
 * 
 * @module test/mock-helpers
 */

/**
 * Sets up default database mock implementations for common queries
 * 
 * This function configures the mock client and pool to handle typical
 * database operations including transactions, user creation, role lookups,
 * and organization management.
 * 
 * Both client.query and pool.query share the same implementation to ensure
 * consistent behavior regardless of which connection method is used.
 * 
 * @param {Object} __mClient - Mocked database client from pg module
 * @param {Object} __mPool - Mocked connection pool from pg module
 * 
 * @example
 * const { Pool } = require('pg');
 * const { setupDefaultMocks } = require('./mock-helpers');
 * 
 * beforeEach(() => {
 *   const pool = new Pool();
 *   const { __mClient, __mPool } = require('pg');
 *   setupDefaultMocks(__mClient, __mPool);
 * });
 */
function setupDefaultMocks(__mClient, __mPool) {
  // Shared implementation for both client.query and pool.query
  const sharedQueryImpl = (query, params = []) => {
    const queryStr = typeof query === 'string' ? query : query.text || '';
    
    // Transaction commands
    if (/BEGIN/i.test(queryStr)) {
      return Promise.resolve({ rows: [] });
    }
    if (/COMMIT/i.test(queryStr)) {
      return Promise.resolve({ rows: [] });
    }
    if (/ROLLBACK/i.test(queryStr)) {
      return Promise.resolve({ rows: [] });
    }
    
    // User management
    if (/INSERT INTO users/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          email: params[0] || 'test@example.com',
          full_name: params[2] || 'Test User',
          is_verified: params[3] !== undefined ? params[3] : true,
          created_at: new Date(),
          updated_at: new Date()
        }]
      });
    }
    
    if (/SELECT \* FROM users WHERE email/i.test(queryStr)) {
      // Return null for user not found (used in registration to check if email exists)
      return Promise.resolve({ rows: [] });
    }
    
    if (/SELECT \* FROM users WHERE id/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: params[0] || 1,
          email: 'test@example.com',
          full_name: 'Test User',
          is_verified: true
        }]
      });
    }
    
    // Role management
    if (/SELECT id FROM roles WHERE role_name/i.test(queryStr)) {
      const roleMap = {
        'admin': 1,
        'animation': 2,
        'parent': 3
      };
      const roleName = params[0];
      const roleId = roleMap[roleName] || 1;
      return Promise.resolve({
        rows: [{ id: roleId }]
      });
    }
    
    if (/SELECT \* FROM roles/i.test(queryStr)) {
      return Promise.resolve({
        rows: [
          { id: 1, role_name: 'admin', display_name: 'Administrator' },
          { id: 2, role_name: 'animation', display_name: 'Animation' },
          { id: 3, role_name: 'parent', display_name: 'Parent' }
        ]
      });
    }
    
    // Organization management
    if (/INSERT INTO user_organizations/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          user_id: params[0] || 1,
          organization_id: params[1] || 3,
          role_ids: params[2] || [3]
        }]
      });
    }
    
    if (/SELECT \* FROM user_organizations WHERE user_id/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          user_id: params[0] || 1,
          organization_id: 3,
          role_ids: [1]
        }]
      });
    }
    
    if (/SELECT \* FROM organizations WHERE id/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: params[0] || 3,
          name: 'Demo Organization',
          subdomain: 'demo',
          use_local_groups: false,
          created_at: new Date()
        }]
      });
    }
    
    if (/organization_domains/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{ organization_id: 3 }]
      });
    }
    
    // Participants
    if (/INSERT INTO participants/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          first_name: params[0] || 'Test',
          last_name: params[1] || 'Participant',
          organization_id: params[2] || 3
        }]
      });
    }
    
    if (/SELECT \* FROM participants/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          first_name: 'Test',
          last_name: 'Participant',
          organization_id: 3
        }]
      });
    }
    
    // Activities
    if (/INSERT INTO activities/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          name: params[0] || 'Test Activity',
          organization_id: params[1] || 3,
          activity_date: params[2] || new Date()
        }]
      });
    }
    
    if (/SELECT \* FROM activities/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          name: 'Test Activity',
          organization_id: 3,
          activity_date: new Date()
        }]
      });
    }
    
    // Guardians
    if (/INSERT INTO guardians/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          participant_id: params[0] || 1,
          first_name: params[1] || 'Test',
          last_name: params[2] || 'Guardian'
        }]
      });
    }
    
    if (/SELECT \* FROM guardians/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          participant_id: 1,
          first_name: 'Test',
          last_name: 'Guardian',
          email: 'guardian@example.com'
        }]
      });
    }
    
    // Forms
    if (/INSERT INTO forms/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          title: params[0] || 'Test Form',
          organization_id: params[1] || 3
        }]
      });
    }
    
    if (/SELECT \* FROM forms/i.test(queryStr)) {
      return Promise.resolve({
        rows: [{
          id: 1,
          title: 'Test Form',
          organization_id: 3
        }]
      });
    }
    
    // Default fallback for unknown queries
    console.warn(`Unhandled query in mock: ${queryStr.substring(0, 100)}`);
    return Promise.resolve({ rows: [] });
  };
  
  // Both client and pool use the same implementation
  __mClient.query.mockImplementation(sharedQueryImpl);
  __mPool.query.mockImplementation(sharedQueryImpl);
}

/**
 * Creates a mock database pool instance with default exports
 * 
 * @returns {Object} Mock pool with __mClient and __mPool references
 * 
 * @example
 * const mockPool = createMockPool();
 * setupDefaultMocks(mockPool.__mClient, mockPool.__mPool);
 */
function createMockPool() {
  const mClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  
  return {
    Pool: jest.fn(() => mPool),
    __esModule: true,
    __mClient: mClient,
    __mPool: mPool
  };
}

/**
 * Resets all mocks to their default state
 * 
 * @param {Object} __mClient - Mocked database client
 * @param {Object} __mPool - Mocked connection pool
 * 
 * @example
 * afterEach(() => {
 *   const { __mClient, __mPool } = require('pg');
 *   resetMocks(__mClient, __mPool);
 * });
 */
function resetMocks(__mClient, __mPool) {
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.query.mockClear();
  __mPool.connect.mockClear();
}

/**
 * Sets up a custom mock response for a specific query pattern on BOTH client and pool
 * 
 * This ensures consistent behavior whether the code uses client.query or pool.query
 * 
 * @param {Object} __mClient - Mocked database client
 * @param {Object} __mPool - Mocked connection pool
 * @param {RegExp|string} pattern - Query pattern to match
 * @param {Object|Array} response - Mock response data
 * 
 * @example
 * mockQuery(__mClient, __mPool, /SELECT \* FROM custom_table/, {
 *   rows: [{ id: 1, name: 'Custom' }]
 * });
 */
function mockQuery(__mClient, __mPool, pattern, response) {
  const existingImpl = __mClient.query.getMockImplementation();
  
  const newImpl = (query, params) => {
    const queryStr = typeof query === 'string' ? query : query.text || '';
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    
    if (regex.test(queryStr)) {
      return Promise.resolve(Array.isArray(response) ? { rows: response } : response);
    }
    
    // Fall back to existing implementation
    return existingImpl ? existingImpl(query, params) : Promise.resolve({ rows: [] });
  };
  
  // Apply to both client and pool
  __mClient.query.mockImplementation(newImpl);
  __mPool.query.mockImplementation(newImpl);
}

/**
 * Sets up a completely custom mock implementation for BOTH client and pool queries
 * 
 * Use this when you need full control over mock behavior in a specific test.
 * The implementation function will be called for both client.query and pool.query.
 * 
 * @param {Object} __mClient - Mocked database client
 * @param {Object} __mPool - Mocked connection pool
 * @param {Function} implementation - Custom mock implementation function(query, params)
 * 
 * @example
 * mockQueryImplementation(__mClient, __mPool, (query, params) => {
 *   if (query.includes('users')) return { rows: [{ id: 100 }] };
 *   return { rows: [] };
 * });
 */
function mockQueryImplementation(__mClient, __mPool, implementation) {
  __mClient.query.mockImplementation(implementation);
  __mPool.query.mockImplementation(implementation);
}

module.exports = {
  setupDefaultMocks,
  createMockPool,
  resetMocks,
  mockQuery,
  mockQueryImplementation
};
