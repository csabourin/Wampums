# Claude AI Development Guidelines for Wampums

This document contains important patterns, conventions, and requirements for Claude AI when working on the Wampums codebase.

## 🚨 CRITICAL: Cache Invalidation & Data Consistency

**ALWAYS invalidate caches immediately after database mutations to ensure users see changes right away.**

### Cache Invalidation Pattern

When modifying data (CREATE, UPDATE, DELETE operations), you MUST:

1. **Perform the database operation**
2. **Immediately invalidate related caches** - both IndexedDB and any in-memory caches
3. **Return success to the user**

### Available Cache Invalidation Functions

Located in `spa/indexedDB.js`:

- `clearCarpoolRelatedCaches(activityId)` - Clear carpool caches
- `clearActivityRelatedCaches()` - Clear activity caches
- `clearParticipantRelatedCaches()` - Clear participant caches
- `clearGroupRelatedCaches()` - Clear group caches
- `clearBadgeRelatedCaches()` - Clear badge caches
- `clearFundraiserRelatedCaches(fundraiserId)` - Clear fundraiser caches
- `clearFinanceRelatedCaches(participantFeeId)` - Clear finance caches
- `deleteCachedData(key)` - Delete a specific cache key

### Example: Carpool Assignment

```javascript
// ❌ WRONG - No cache invalidation
export async function assignParticipantToCarpool(assignmentData) {
  const response = await API.post('v1/carpools/assignments', assignmentData);
  return response.data;
}

// ✅ CORRECT - Cache invalidated immediately
export async function assignParticipantToCarpool(assignmentData) {
  const response = await API.post('v1/carpools/assignments', assignmentData);
  // Invalidate all carpool caches to ensure fresh data
  await clearCarpoolRelatedCaches();
  return response.data;
}
```

### What to Invalidate

When you modify data, invalidate caches for:

1. **The specific resource** (e.g., `v1/carpools/activity/123`)
2. **Related list endpoints** (e.g., `v1/carpools/my-offers`)
3. **Aggregate endpoints** (e.g., `v1/carpools/activity/123/unassigned`)
4. **Parent resources** (e.g., `v1/activities/123/participants`)

### Cache Keys Format

Cache keys in IndexedDB follow this pattern:
- `v1/carpools/activity/{activityId}` - Carpool offers for an activity
- `v1/carpools/activity/{activityId}/unassigned` - Unassigned participants
- `v1/activities/{activityId}` - Activity details
- `v1/activities/{activityId}/participants` - Activity participants

## 🎯 Optimistic Updates (Future Enhancement)

For an even better user experience, implement optimistic updates:

1. **Update UI immediately** with expected data
2. **Make API request** in background
3. **If success**: Cache is already invalidated, data will refresh
4. **If error**: Revert UI and show error message

Example pattern:
```javascript
async function assignParticipant(data) {
  // 1. Optimistically update UI
  const optimisticAssignment = { ...data, id: 'temp-' + Date.now() };
  updateUIWithAssignment(optimisticAssignment);

  try {
    // 2. Make API request (which invalidates cache)
    const result = await assignParticipantToCarpool(data);

    // 3. Replace optimistic data with real data
    replaceOptimisticWithReal(optimisticAssignment.id, result);
  } catch (error) {
    // 4. Revert optimistic update
    removeOptimisticAssignment(optimisticAssignment.id);
    showError(error.message);
  }
}
```

## 📝 IndexedDB Structure

All cached data is stored in IndexedDB with this structure:

```javascript
{
  key: 'v1/carpools/activity/123',        // Cache key
  data: { success: true, data: [...] },   // The actual response data
  type: 'cache',                          // Always 'cache' for cached data
  timestamp: 1234567890,                  // When cached (ms)
  expiration: 1234567890 + cacheDuration  // When expires (ms)
}
```

## 🔄 Data Flow

```
User Action → API Request → Database Update → Cache Invalidation → UI Refresh → Fresh Data from Server
```

**Never skip cache invalidation** - users should always see their changes immediately!

## 🛡️ Important Rules

1. **ALWAYS** invalidate caches after mutations (POST, PUT, DELETE)
2. **NEVER** rely on cache expiration alone for data consistency
3. **ALWAYS** clear related caches, not just the direct endpoint
4. **CONSIDER** implementing optimistic updates for frequently used features
5. **TEST** that changes appear immediately without clearing browser cache

## 📚 Related Files

- `spa/indexedDB.js` - Cache management functions
- `spa/api/api-core.js` - Core API request handling
- `spa/api/api-carpools.js` - Carpool API with cache invalidation examples
- `spa/api/api-activities.js` - Activity API endpoints
- `spa/api/api-participants.js` - Participant API endpoints

---

**Remember: The best user experience is when changes appear instantly. Cache invalidation makes this possible!**
