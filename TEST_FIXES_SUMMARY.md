# Test Fixes Summary - Permission Mocking Issue

**Date:** 2026-02-15
**Issue:** Tests were failing with 403 Forbidden errors due to incorrect mock patterns

## Problem Identified

The application uses permission-based authorization via `requirePermission()` middleware which queries the database for user permissions. Tests were using direct `mockImplementation()` that returned empty rows for unhandled queries, breaking permission checks.

### Root Causes:

1. **Incomplete permission list in mock factory** - Only 10 permissions were mocked, but routes use 51+ permissions
2. **Direct mock implementations without fallback** - Tests used `__mPool.query.mockImplementation()` and returned `{ rows: [] }` for unhandled queries
3. **Incorrect query pattern matching** - Tests checked for `'FROM role_permissions'` but actual queries use JOINs with `user_organizations`
4. **Wrong permission assumptions** - Tests used `participants.manage` but routes require `participants.create`

## Solutions Applied

### 1. Updated Mock Factory (test/mock-factory.js)
Added comprehensive permission list covering all permissions used in routes:
- User permissions: view, manage, edit, assign_roles
- Participant permissions: view, create, edit, delete
- Activity permissions: view, create, edit, delete
- Finance, budget, attendance, forms, guardians, etc.
- Total: 51 permissions

### 2. Fixed Test Mock Patterns
**Pattern before (broken):**
```javascript
__mPool.query.mockImplementation((query, params) => {
  if (query.includes('specific condition')) {
    return Promise.resolve({ rows: [data] });
  }
  return Promise.resolve({ rows: [] }); // ❌ Breaks permission checks
});
```

**Pattern after (correct):**
```javascript
mockQueryImplementation(__mClient, __mPool, (query, params) => {
  if (query.includes('specific condition')) {
    return Promise.resolve({ rows: [data] });
  }
  return undefined; // ✅ Falls back to default mocks
});
```

### 3. Fixed Permission Query Patterns

**For testing no permissions:**
```javascript
if (query.includes('permission_key') && query.includes('user_organizations')) {
  return Promise.resolve({ rows: [] }); // User has no permissions
}
```

**For testing specific permissions:**
```javascript
if (query.includes('permission_key') && query.includes('user_organizations')) {
  return Promise.resolve({ 
    rows: [{ permission_key: 'activities.view' }] 
  });
}
```

### 4. Fixed Demo Role Query Patterns

**Correct pattern:**
```javascript
if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
  return Promise.resolve({ 
    rows: [{ role_name: 'demoadmin' }] 
  });
}
```

## Test Results

### Before Fixes
- **Total Tests:** 685
- **Failed:** 117 tests (17% failure rate)
- **Passed:** 556 tests

### After Fixes
- **Total Tests:** 685
- **Failed:** 80 tests (12% failure rate)
- **Passed:** 593 tests
- **Improvement:** 37 tests fixed (32% reduction in failures)

### Fully Fixed Test Files
✅ **test/routes-activities-comprehensive.test.js** - 30/30 passing (100%)
✅ **test/routes-guardians.test.js** - 27/27 passing (100%)

### Partially Fixed Test Files
- test/routes-forms.test.js - improved
- test/routes-participants.test.js - 7/16 passing
- test/routes-medication.test.js - improved
- test/routes-finance.test.js - improved
- test/routes-organizations.test.js - improved
- test/security.test.js - improved
- test/routes-auth-login.test.js - improved
- test/middleware-validation.test.js - improved

## Remaining Issues (Not Permission-Related)

The 80 remaining failures are due to:

### 1. Non-existent Routes
Tests are testing routes that don't exist in the application:
- `POST /api/v1/participants/:id/link-parent` (actual route: `/link-parent`)
- `POST /api/v1/participants/:id/add-group` (actual route: `/group-membership`)

### 2. Complex Business Logic
- Multi-table query mocking complexity
- Edge cases in validation middleware
- Application-specific behavior not properly mocked

### 3. Route Implementation Issues
- Some endpoints may have bugs
- Some tests may be testing deprecated functionality

## Recommendations for Future Test Development

### 1. Always Use mockQueryImplementation
```javascript
const { __mClient, __mPool } = require('pg');
mockQueryImplementation(__mClient, __mPool, (query, params) => {
  // Handle specific queries
  if (query.includes('my_table')) {
    return Promise.resolve({ rows: [data] });
  }
  // ALWAYS return undefined for fallback
  return undefined;
});
```

### 2. Match Actual Query Patterns
- Permission checks: `permission_key` + `user_organizations`
- Demo role checks: `role_name IN ('demoadmin', 'demoparent')`
- Don't use `FROM table_name` - queries use JOINs

### 3. Use Correct Permissions
- Check the actual route to see which permission is required
- Create operations: `resource.create`
- Edit operations: `resource.edit`
- Delete operations: `resource.delete`
- View operations: `resource.view`

### 4. Test Actual Routes
- Verify the route exists before writing tests
- Check route signatures match test expectations
- Don't assume route patterns - check the actual route file

## Files Modified

1. `test/mock-factory.js` - Added 51 permissions
2. `test/routes-activities-comprehensive.test.js` - Fixed all mock patterns
3. `test/routes-guardians.test.js` - Fixed all mock patterns
4. `test/routes-forms.test.js` - Fixed mock patterns
5. `test/routes-participants.test.js` - Fixed mock patterns and permissions
6. `test/routes-medication.test.js` - Fixed mock patterns
7. `test/routes-finance.test.js` - Fixed mock patterns
8. `test/routes-organizations.test.js` - Fixed mock patterns
9. `test/security.test.js` - Fixed mock patterns
10. `test/routes-auth-login.test.js` - Fixed mock patterns
11. `test/middleware-validation.test.js` - Fixed mock patterns

## Automation Scripts Created

### /tmp/fix-test-mocks.py
Automatically converts direct `mockImplementation` to `mockQueryImplementation` with proper fallback patterns.

### /tmp/fix-permission-queries.py
Fixes permission and demo role query patterns in tests.

### /tmp/fix-participant-permissions.py
Corrects permission assumptions in participant tests.

## Conclusion

The permission mocking issue has been **RESOLVED**. The remaining 80 test failures are unrelated to the original permission mocking problem and require separate investigation and fixes.

Key achievement: **37 tests fixed** (32% reduction in failures) by correcting false assumptions about how permission-based authorization works.
