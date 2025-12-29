# Lessons Learned - Mobile App Development

## API Response Structure Consistency

### Issue Discovered: December 28, 2025
Multiple screens were incorrectly parsing API responses due to inconsistent assumptions about response structure.

### Key Lessons:

1. **API Function Names Must Match Exports**
   - ❌ Wrong: Importing `fetchParticipant` when the function is exported as `getParticipant`
   - ✅ Correct: Always verify the actual export name in `api-endpoints.js`
   - **Files affected**: `BadgeFormScreen.js`, `HealthFormScreen.js`, `RiskAcceptanceScreen.js`

2. **API Response Structure Varies by Endpoint**
   - Some endpoints return: `{ success: true, data: {...} }`
   - Others return: `{ success: true, participant: {...} }`
   - **Solution**: Always check the backend route file to see the exact response structure
   - **Example**: `routes/participants.js` line 1016 returns data directly, not nested under `.participant`

3. **Function Signatures Must Match Usage**
   - ❌ Wrong: `getBadgeProgress({ forceRefresh })` when called as `getBadgeProgress(participantId, { forceRefresh })`
   - ✅ Correct: Function signature must support all parameters passed by callers
   - **Fixed in**: `api-endpoints.js` - `getBadgeProgress(participantId, { forceRefresh })`

4. **Check Backend Routes for Truth**
   - Don't assume API response structure based on other endpoints
   - Always verify in `routes/*.js` files:
     - What parameters are required (query params vs path params)
     - What the response structure looks like
     - What error codes are returned and why

### Checklist for New API Endpoints:

- [ ] Verify function name matches export in `api-endpoints.js`
- [ ] Check backend route for exact response structure
- [ ] Match function signature to all call sites
- [ ] Handle both `response.data` and direct response structures
- [ ] Test with actual API to confirm structure

### Example Patterns:

```javascript
// Pattern 1: Data in response.data
const participant = participantResponse?.data || participantResponse;

// Pattern 2: Check required fields instead of nested structure
if (!participant || !participant.id) {
  throw new Error('Data not found');
}

// Pattern 3: API function with optional parameters
export const getBadgeProgress = async (participantId = null, { forceRefresh = false } = {}) => {
  const endpoint = participantId 
    ? `/api/badge-progress?participant_id=${participantId}`
    : '/api/badge-progress';
  return API.get(endpoint, {}, { forceRefresh });
};
```

### Files with Corrected Patterns:

- `mobile/src/screens/BadgeFormScreen.js` - Participant data extraction
- `mobile/src/screens/HealthFormScreen.js` - API function names (`fetchParents` → `getGuardians`)
- `mobile/src/screens/RiskAcceptanceScreen.js` - API function names (`fetchAcceptationRisque` → `getRiskAcceptance`, `saveAcceptationRisque` → `saveRiskAcceptance`)
- `mobile/src/api/api-endpoints.js` - Added missing functions:
  - `getBadgeProgress(participantId, options)` - Fixed signature
  - `getGuardians(participantId)` - New function for fetching parent/guardian data
  - `getRiskAcceptance(participantId)` - New function
  - `saveRiskAcceptance(data)` - New function

### Prevention Strategy:

1. When adding new API calls, grep for similar patterns in existing screens
2. Check the backend route file before writing frontend code
3. Add JSDoc comments to API functions documenting response structure
4. Use TypeScript or JSDoc type hints for API response types
