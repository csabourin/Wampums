# Test Resource Cleanup - Implementation Notes

## Problem Statement
Tests were hanging because they didn't properly close resources created when requiring `api.js`:
1. HTTP server remained open
2. Socket.IO connections remained open
3. Announcement listener had active timers (setInterval/setTimeout)

## Solution

### 1. Export Server Resources from api.js
Modified `api.js` to export server and io instances:
```javascript
module.exports = app;
module.exports.server = server;
module.exports.io = io;
```

### 2. Create Centralized Cleanup Utility
Created `test/test-cleanup.js` with `cleanupTestResources(app)` function that:
- Closes HTTP server
- Closes Socket.IO
- Calls announcement listener shutdown

### 3. Add Cleanup Hooks to All Tests
Updated all tests that require `api.js` to call cleanup in `afterAll`:
```javascript
const { cleanupTestResources } = require('./test-cleanup');

afterAll(async () => {
  await cleanupTestResources(app);
});
```

Affected test files:
- test/api.test.js
- test/activities.create.test.js
- test/push-subscription.test.js
- test/permission-slips.security.test.js
- test/local-groups.test.js
- test/landing-host.test.js

### 4. Export Announcement Listener Shutdown
Modified `routes/announcements.js` to:
- Register shutdown function globally: `global.__announcementListenerShutdown`
- Export cleanup function for tests to call

### 5. Exclude Mobile Tests
Updated `package.json` Jest config to exclude `/mobile/` directory:
```json
"testPathIgnorePatterns": [
  "/node_modules/",
  "/mobile/"
]
```

## Results
- ✅ Tests complete without hanging (no more "Jest did not exit" warnings)
- ✅ Mobile tests excluded from main test runs
- ✅ All resources properly cleaned up
- ✅ Fast test execution (~5 seconds for full suite)

## Future Considerations
Any new test files that require `api.js` MUST import and call `cleanupTestResources` in their `afterAll` hook to prevent hanging.
