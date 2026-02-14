# Test Mock Helpers - Implementation Guide

## Summary

Created centralized database mock infrastructure to fix 181 failing tests caused by incomplete and inconsistent mock implementations across test suites.

## What Was Fixed

### Core Problem
- **Before**: Each of 20+ test files had duplicated `jest.mock('pg')` code
- **Issue**: Incomplete mock implementations didn't handle:
  - Transaction commands (BEGIN/COMMIT/ROLLBACK)
  - Proper `result.rows[0].id` structure
  - Consistent behavior between `client.query` and `pool.query`
- **Impact**: 181 tests failing with "Cannot read properties of undefined (reading 'rows')"

### Solution Implemented

#### 1. Created `test/mock-helpers.js`
Centralized mock helper with:
- `setupDefaultMocks(__mClient, __mPool)` - Sets up comprehensive database mocks
- `mockQueryImplementation(__mClient, __mPool, fn)` - Override mocks for specific tests
- `mockQuery(__mClient, __mPool, pattern, response)` - Mock specific query patterns
- `resetMocks(__mClient, __mPool)` - Clean up between tests

#### 2. Updated All Test Files
Modified 20+ test files to use shared mock helper:
- `routes-users.test.js`
- `routes-activities-comprehensive.test.js`
- `routes-guardians.test.js`
- `routes-forms.test.js`
- `routes-participants.test.js`
- `routes-medication.test.js`
- `routes-finance.test.js`
- `routes-auth-login.test.js`
- `routes-organizations.test.js`
- `routes-stripe-payments.test.js`
- `landing-host.test.js`
- `push-subscription.test.js`
- `permission-slips.security.test.js`
- `security.test.js`
- `api.test.js`
- `activities.calendar.test.js`
- `middleware-auth-permissions.test.js`
- `api-consistency.test.js`
- `local-groups.test.js`
- `activities.create.test.js`

## Mock Coverage

The `setupDefaultMocks` function now handles:

### Transaction Commands
```javascript
BEGIN → { rows: [] }
COMMIT → { rows: [] }
ROLLBACK → { rows: [] }
```

### User Management
```javascript
INSERT INTO users → { rows: [{ id: 1, email, full_name, is_verified, created_at, updated_at }] }
SELECT * FROM users WHERE email → { rows: [] } // for registration check
SELECT * FROM users WHERE id → { rows: [{ id, email, full_name, is_verified }] }
```

### Role Management
```javascript
SELECT id FROM roles WHERE role_name → { rows: [{ id: 1|2|3 }] } // admin=1, animation=2, parent=3
SELECT * FROM roles → { rows: [all roles] }
```

### Organization Management
```javascript
INSERT INTO user_organizations → { rows: [{ id, user_id, organization_id, role_ids }] }
SELECT * FROM user_organizations → { rows: [user org data] }
SELECT * FROM organizations WHERE id → { rows: [{ id, name, subdomain, ... }] }
SELECT FROM organization_domains → { rows: [{ organization_id: 3 }] }
```

### Participants, Activities, Guardians, Forms
Comprehensive INSERT and SELECT mocks for all major entities.

## Usage Guide

### Basic Setup (Already Applied)

```javascript
const { Pool } = require('pg');
const { setupDefaultMocks } = require('./mock-helpers');
let app;

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  __mClient.query.mockClear();
  __mClient.release.mockClear();
  __mPool.connect.mockClear();
  __mPool.query.mockClear();
});
```

### Overriding Mocks for Specific Tests

#### Example: Custom User ID
```javascript
test('creates user with specific ID', async () => {
  const { __mClient, __mPool } = require('pg');
  const { mockQueryImplementation } = require('./mock-helpers');

  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    if (query.includes('INSERT INTO users')) {
      return Promise.resolve({
        rows: [{ id: 100, email: params[0], full_name: params[2], is_verified: true }]
      });
    }
    if (query.includes('SELECT id FROM roles')) {
      return Promise.resolve({ rows: [{ id: 3 }] });
    }
    if (query.includes('INSERT INTO user_organizations')) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    if (/BEGIN|COMMIT/i.test(query)) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });

  const res = await request(app).post('/api/v1/users').send({...});
  expect(res.body.data.id).toBe(100);
});
```

#### Example: Database Constraint Violation
```javascript
test('rejects duplicate email', async () => {
  const { __mClient, __mPool } = require('pg');
  const { mockQueryImplementation } = require('./mock-helpers');

  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    if (query.includes('INSERT INTO users')) {
      const error = new Error('duplicate key value violates unique constraint "users_email_key"');
      error.code = '23505';
      error.constraint = 'users_email_key';
      return Promise.reject(error);
    }
    if (/BEGIN|ROLLBACK/i.test(query)) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });

  const res = await request(app).post('/public/register').send({...});
  expect(res.status).toBe(400);
});
```

## Key Architectural Decisions

### 1. Shared Implementation for Client and Pool
Both `client.query` and `pool.query` use the same mock implementation to ensure consistent behavior regardless of how routes access the database.

**Why**: Some routes use `pool.query()` directly, while others use `const client = await pool.connect(); client.query()`. Tests were failing because mocks didn't cover both patterns.

### 2. Override on Both for Custom Mocks
The `mockQueryImplementation()` helper applies custom mocks to BOTH `__mClient` and `__mPool`.

**Why**: Tests that override mocks need to affect both query patterns. If you only override `__mPool.query`, client-based queries will still use defaults.

### 3. Warning for Unhandled Queries
The default implementation logs a warning when encountering unknown query patterns.

**Why**: Helps identify missing mock coverage during test development.

## Test Results

### Before Mock Helpers
```
Test Suites: 14 failed, 19 passed, 33 total
Tests:       181 failed, 12 skipped, 479 passed, 672 total
```

### After Mock Helpers (Example - Registration Tests)
```
Test Suites: 31 skipped, 2 passed, 2 of 33 total
Tests:       666 skipped, 6 passed, 672 total
```

Registration tests now passing:
- ✅ Creates new user account with valid registration data
- ✅ Rejects registration with weak password
- ✅ Rejects registration with existing email
- ✅ Validates required fields
- ✅ Auto-verifies parent role users
- ✅ Requires admin approval for animation role

## Remaining Work

Many tests still need individual attention to:
1. Update custom mock implementations to use `mockQueryImplementation(__mClient, __mPool, fn)`
2. Fix test assertions to match actual API response structure (e.g., `res.body.data.id` not `res.body.user_id`)
3. Add missing query patterns to default mocks
4. Handle edge cases (rate limiting, password resets, etc.)

### Pattern for Updating Failing Tests

1. Run test to see error message
2. Identify which queries are failing
3. Add custom mock using `mockQueryImplementation`
4. Ensure mock includes ALL relevant queries (BEGIN, COMMIT, organization lookup, actual operation)
5. Update test assertions to match API response structure

### Example: Password Reset Test
```javascript
test('password reset flow works', async () => {
  const { __mClient, __mPool } = require('pg');
  const { mockQueryImplementation } = require('./mock-helpers');

  mockQueryImplementation(__mClient, __mPool, (query, params) => {
    if (query.includes('SELECT * FROM users WHERE email')) {
      return Promise.resolve({
        rows: [{ id: 1, email: 'user@example.com', is_verified: true }]
      });
    }
    if (query.includes('INSERT INTO password_reset')) {
      return Promise.resolve({ rows: [{ token: 'reset_token' }] });
    }
    if (query.includes('UPDATE password_reset')) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    if (query.includes('UPDATE users SET password')) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    if (/BEGIN|COMMIT/i.test(query)) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });

  // Test implementation...
});
```

## Benefits Achieved

1. **Consistency**: All tests mock database operations the same way
2. **Maintainability**: Single source of truth for common mock behaviors
3. **Completeness**: Transaction commands now properly handled
4. **Flexibility**: Tests can easily override mocks when needed
5. **Documentation**: Mock helper functions are well-documented with JSDoc

## Future Enhancements

Consider adding to `mock-helpers.js`:
- `mockStripeError()` - Simulate Stripe API errors
- `mockEmailSending()` - Mock email service calls
- `mockS3Upload()` - Mock file upload operations
- `mockAIService()` - Mock AI service responses

## Questions?

See `test/routes-auth-login.test.js` for complete examples of:
- Basic test setup with `setupDefaultMocks`
- Custom mocks with `mockQueryImplementation`
- Database constraint violation simulation
- Transaction handling
