# Web to React Native Utility Mapping

This document provides a comprehensive mapping from existing web utilities (SPA) to their React Native equivalents in the mobile app.

## Overview

The Wampums mobile app mirrors the functionality of the web SPA while using React Native-specific implementations. This document helps developers understand:

1. **Where to find equivalent utilities** in the mobile codebase
2. **API compatibility** between web and mobile implementations
3. **Platform-specific differences** to be aware of

---

## Storage & Session Management

### `spa/utils/StorageUtils.js` → `mobile/src/utils/StorageUtils.js`

| Web Function | RN Function | Notes |
|-------------|-------------|-------|
| `localStorage.setItem()` | `StorageUtils.setItem()` | Uses AsyncStorage for non-sensitive data |
| `localStorage.getItem()` | `StorageUtils.getItem()` | Automatically parses JSON |
| `localStorage.removeItem()` | `StorageUtils.removeItem()` | Works with both AsyncStorage and SecureStore |
| `setStorageMultiple()` | `setStorageMultiple()` | Same API, async implementation |
| `getStorageMultiple()` | `getStorageMultiple()` | Returns object with key-value pairs |
| `clearUserData()` | `clearUserData()` | Preserves device_token and language preferences |
| - | `clearAllStorage()` | New: Complete storage wipe |

**Key Differences:**
- **Secure Storage**: RN uses `expo-secure-store` for JWT tokens (more secure than localStorage)
- **Async API**: All storage operations are async and return Promises
- **JSON Handling**: Automatic JSON serialization/deserialization

**Example Migration:**
```javascript
// Web (spa/)
localStorage.setItem('userId', user.id);
const userId = localStorage.getItem('userId');

// React Native (mobile/)
await StorageUtils.setItem('userId', user.id);
const userId = await StorageUtils.getItem('userId');
```

---

## JWT & Authentication

### `spa/jwt-helper.js` → `mobile/src/utils/StorageUtils.js`

| Web Function | RN Function | Notes |
|-------------|-------------|-------|
| `setCurrentJWT()` | `StorageUtils.setJWT()` | Stores in SecureStore |
| `getCurrentJWT()` | `StorageUtils.getJWT()` | Retrieves from SecureStore |
| `clearJWT()` | `StorageUtils.clearJWT()` | Removes from SecureStore |
| `decodeJWT()` | `StorageUtils.decodeJWT()` | Same implementation |
| `getAuthHeader()` | (built into API client) | Automatic in `api-core.js` |
| - | `isJWTExpired()` | New: Check token expiration |
| - | `getCurrentUserFromJWT()` | New: Extract user from token |

**Key Differences:**
- **Secure Storage**: JWT tokens are stored in device Keychain/Keystore, not localStorage
- **Auto-attachment**: Auth headers are automatically added to all API requests

---

## API Client

### `spa/api/api-core.js` → `mobile/src/api/api-core.js`

| Web Function | RN Function | Notes |
|-------------|-------------|-------|
| `API.get()` | `API.get()` | Same signature |
| `API.post()` | `API.post()` | Same signature |
| `API.put()` | `API.put()` | Same signature |
| `API.delete()` | `API.delete()` | Same signature |
| - | `API.patch()` | New: PATCH method support |
| `fetchPublic()` | `API.public()` | For unauthenticated requests |

**Key Differences:**
- **Auto-retry**: RN client includes exponential backoff retry logic
- **Response Normalization**: All responses normalized to `{ success, message, data, timestamp }`
- **401 Handling**: Automatic session clear and logout on unauthorized
- **Axios**: Uses axios instead of fetch for better error handling

**Example Migration:**
```javascript
// Web (spa/)
const response = await API.get('v1/participants');

// React Native (mobile/) - Same API!
const response = await API.get('v1/participants');
```

---

## API Endpoints

### `spa/api/api-endpoints.js` → `mobile/src/api/api-endpoints.js`

All endpoint functions maintain the same signatures and behavior:

| Category | Web Functions | RN Functions | Notes |
|----------|--------------|--------------|-------|
| **Auth** | `login()`, `logout()`, `verify2FA()` | Same | Identical API |
| **Participants** | `getParticipants()`, `createParticipant()`, etc. | Same | Identical API |
| **Activities** | `getActivities()`, `createActivity()`, etc. | Same | Identical API |
| **Carpools** | `getCarpoolOffers()`, `assignParticipantToCarpool()`, etc. | Same | Identical API |
| **Finance** | `getFeeDefinitions()`, `getParticipantFees()`, etc. | Same | Identical API |
| **Groups** | `getGroups()`, `createGroup()`, etc. | Same | Identical API |

**100% API Compatibility**: All endpoint functions work identically between web and mobile.

---

## Internationalization (i18n)

### `spa/app.js` (translation) → `mobile/src/i18n/index.js`

| Web Function | RN Function | Notes |
|-------------|-------------|-------|
| `loadTranslation()` | `initI18n()` | Loads translations on app start |
| `translate()` | `translate()` or `t()` | Same API |
| `changeLanguage()` | `changeLanguage()` | Same behavior |
| `document.documentElement.lang` | `getCurrentLanguage()` | Get current locale |

**Key Differences:**
- **Library**: Uses `i18n-js` instead of custom implementation
- **Bundle Loading**: Static translations bundled with app
- **Device Locale**: Auto-detects device language on first launch
- **Same Keys**: Uses identical translation keys from `lang/en.json` and `lang/fr.json`

**Example Migration:**
```javascript
// Web (spa/)
translate('common.save')

// React Native (mobile/) - Same API!
translate('common.save')
// or shorter:
t('common.save')
```

---

## Security Utilities

### New: `mobile/src/utils/SecurityUtils.js`

| Function | Purpose | Equivalent in Web |
|----------|---------|-------------------|
| `sanitizeInput()` | Remove HTML tags and sanitize text | Custom implementations in SPA |
| `escapeHtml()` | Escape special characters | Custom or DOMPurify |
| `sanitizeEmail()` | Validate and clean email addresses | Validation helpers |
| `sanitizePhone()` | Clean phone numbers | Validation helpers |
| `sanitizeUrl()` | Validate and sanitize URLs | Custom validation |
| `sanitizeName()` | Clean participant names | Custom validation |
| `sanitizeNumber()` | Clean numeric input | Custom validation |
| `validatePasswordStrength()` | Check password requirements | Custom validation |
| `deepSanitize()` | Recursively sanitize objects | - |

**Key Differences:**
- **No HTML Rendering**: RN doesn't render HTML, so focus is on data sanitization for API and display
- **Centralized**: All security functions in one utility module
- **Validation**: Includes both sanitization and validation

---

## Date Formatting

### New: `mobile/src/utils/DateUtils.js`

| Function | Purpose | Web Equivalent |
|----------|---------|----------------|
| `formatDate()` | Locale-aware date formatting | Custom date formatting in SPA |
| `formatTime()` | Locale-aware time formatting | Custom time formatting |
| `formatDateTime()` | Combined date and time | Custom formatting |
| `formatRelativeDate()` | "2 days ago", "in 3 hours" | Custom relative time |
| `getDayName()` | Localized day names | `new Date().toLocaleDateString()` |
| `getMonthName()` | Localized month names | Custom month arrays |
| `calculateAge()` | Age from birthdate | Custom calculation |
| `isToday()`, `isPast()`, `isFuture()` | Date comparisons | Custom logic |

**Key Differences:**
- **Intl.DateTimeFormat**: Uses native Intl API for locale formatting
- **Bilingual Support**: Automatically formats for en-CA or fr-CA based on language
- **Consistent API**: All functions follow same pattern

**Example:**
```javascript
import DateUtils from '../utils/DateUtils';

// Format a date
const formatted = DateUtils.formatDate(new Date()); // "2025-12-25"

// Relative time
const relative = DateUtils.formatRelativeDate(activityDate); // "in 3 days"

// Calculate age
const age = DateUtils.calculateAge(participant.birthdate); // 12
```

---

## Number & Currency Formatting

### New: `mobile/src/utils/NumberUtils.js`

| Function | Purpose | Web Equivalent |
|----------|---------|----------------|
| `formatNumber()` | Locale-aware number formatting | Custom number formatting |
| `formatCurrency()` | Currency with proper symbols | Custom currency formatting |
| `formatPercentage()` | Percentage formatting | Custom percentage |
| `parseNumber()` | Parse localized numbers | `parseFloat()` with custom logic |
| `formatCompactNumber()` | "1.2K", "3.4M" abbreviations | Custom abbreviation |
| `formatPoints()` | Format point scores | Custom formatting |
| `calculatePercentage()` | Calculate percentage | Custom calculation |

**Key Differences:**
- **Intl.NumberFormat**: Uses native Intl API for all formatting
- **Currency Support**: Proper CAD symbol placement for en/fr locales
- **Locale Parsing**: Handles French comma decimals vs English period decimals

**Example:**
```javascript
import NumberUtils from '../utils/NumberUtils';

// Currency
const amount = NumberUtils.formatCurrency(45.50); // "$45.50" (en) or "45,50 $" (fr)

// Percentage
const percent = NumberUtils.formatPercentage(0.85); // "85%"

// Compact
const followers = NumberUtils.formatCompactNumber(15420); // "15.4K"
```

---

## Configuration

### `spa/config.js` → `mobile/src/config/index.js`

| Web Constant | RN Constant | Notes |
|--------------|-------------|-------|
| `CONFIG.ENDPOINTS.*` | `CONFIG.ENDPOINTS.*` | Identical endpoint paths |
| `CONFIG.STORAGE_KEYS.*` | `CONFIG.STORAGE_KEYS.*` | Same storage key names |
| `CONFIG.API_URL` | `CONFIG.API.BASE_URL` | Environment-driven |
| - | `CONFIG.API.TIMEOUT` | New: Request timeout |
| - | `CONFIG.API.RETRY_ATTEMPTS` | New: Retry configuration |
| - | `CONFIG.FEATURES.*` | New: Feature flags |
| - | `CONFIG.UI.*` | New: UI constants |

**Key Differences:**
- **Environment-Based**: API URL changes based on dev/staging/production
- **Feature Flags**: Mobile-specific features (biometric auth, offline mode)
- **UI Constants**: Touch target sizes and animation durations

---

## Permission & Role Utilities

### `spa/utils/PermissionUtils.js` → Mobile Implementation (TODO)

**Status**: To be implemented in Phase 2

**Planned Functions:**
- `hasPermission(permission)` - Check user permission
- `hasRole(role)` - Check user role
- `canAccessRoute(route)` - Route guard logic

**Migration Notes:**
- Will read permissions from JWT token (same as web)
- Same permission strings as backend
- React Navigation integration for route guards

---

## Offline Support

### `spa/api/api-offline-wrapper.js` + `spa/indexedDB.js` → Mobile Implementation (TODO)

**Status**: To be implemented in Phase 2

**Planned Implementation:**
- AsyncStorage for offline cache (replaces IndexedDB)
- Offline queue for pending mutations
- Background sync when connection restored
- Same cache invalidation patterns as web

**Key Differences:**
- **No IndexedDB**: Uses AsyncStorage + file system
- **Background Sync**: Platform-specific background tasks
- **Network Detection**: Uses `@react-native-community/netinfo`

---

## Summary of Key Platform Differences

### Storage
- **Web**: localStorage (synchronous)
- **RN**: AsyncStorage + SecureStore (asynchronous)

### HTTP Client
- **Web**: fetch API
- **RN**: axios (better error handling, timeouts, retries)

### Date/Number Formatting
- **Web**: Custom implementations or libraries
- **RN**: Native Intl API (better locale support)

### Security
- **Web**: DOMPurify for HTML sanitization
- **RN**: Custom sanitization (no HTML rendering)

### Translations
- **Web**: Custom implementation
- **RN**: i18n-js library

---

## Migration Checklist

When migrating a feature from web to RN:

- [ ] Replace `localStorage` with `await StorageUtils.getItem/setItem()`
- [ ] Use `translate()` or `t()` for all text (same keys as web)
- [ ] Use `DateUtils.formatDate()` for date display
- [ ] Use `NumberUtils.formatCurrency()` for money display
- [ ] Sanitize user input with `SecurityUtils.sanitizeInput()`
- [ ] Use same API endpoint functions from `api-endpoints.js`
- [ ] Respect `CONFIG.STORAGE_KEYS` for consistency
- [ ] Test both English and French locales
- [ ] Ensure touch targets are at least 44px (CONFIG.UI.TOUCH_TARGET_SIZE)

---

## Example: Complete Feature Migration

### Web Code (spa/parent_dashboard.js)
```javascript
// Get participant data
const response = await API.get('v1/participants');
const participants = response.data;

// Display fee
const fee = participant.registrationFee;
document.getElementById('fee').textContent = `$${fee.toFixed(2)}`;

// Display birthdate
const birthdate = new Date(participant.birthdate);
document.getElementById('birthdate').textContent = birthdate.toLocaleDateString();

// Store preference
localStorage.setItem('lastViewedParticipant', participant.id);
```

### React Native Code (mobile/src/screens/ParentDashboardScreen.js)
```javascript
import { getParticipants } from '../api/api-endpoints';
import NumberUtils from '../utils/NumberUtils';
import DateUtils from '../utils/DateUtils';
import StorageUtils from '../utils/StorageUtils';

// Get participant data
const response = await getParticipants();
const participants = response.data;

// Display fee (locale-aware)
const feeText = NumberUtils.formatCurrency(participant.registrationFee);

// Display birthdate (locale-aware)
const birthdateText = DateUtils.formatDate(participant.birthdate);

// Store preference (async)
await StorageUtils.setItem('lastViewedParticipant', participant.id);
```

**Result**: Same functionality, better internationalization, platform-appropriate storage!

---

## Questions or Issues?

If you encounter a utility from the web app that doesn't have a clear RN equivalent:

1. Check this mapping document first
2. Look for similar functionality in `mobile/src/utils/`
3. Check if it's already built into the API client (`api-core.js`)
4. If still unclear, refer to the audit document: `/docs/rn-frontend-audit.md`

---

**Last Updated**: 2025-12-25
**Mobile App Version**: 1.0.0
**Compatibility**: Web SPA v1 APIs
