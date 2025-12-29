# API Naming Normalization Guide

**Last Updated:** 2025-12-29
**Purpose:** Document naming differences between SPA and Mobile API wrappers to facilitate normalization and prevent drift.

---

## Overview

The SPA (`spa/api/api-endpoints.js`) and Mobile (`mobile/src/api/api-endpoints.js`) applications have diverged in their API wrapper naming conventions. This document catalogs these differences and provides recommendations for normalization.

---

## Naming Differences by Domain

### Authentication & Session

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `authenticate` | ❌ Missing | ⚠️ Add to mobile | Session validation wrapper |
| `checkAuthStatus` | ❌ Missing | ⚠️ Add to mobile | Auth status check |
| `validateToken` | ❌ Missing | ⚠️ Add to mobile | Token validation |
| `verify2FA` | `verify2FA` | ✅ Aligned | - |
| `login` | `login` | ✅ Aligned | - |
| `logout` | `logout` | ✅ Aligned | - |
| `register` | `register` | ✅ Aligned | - |

**Recommendation:** Add missing auth helpers to mobile for consistency.

---

### Participants

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `fetchParticipant` | ❌ Missing | ⚠️ Add to mobile | Singular participant fetch |
| `fetchParticipants` | `getParticipants` | 🔄 Normalize | **Recommend:** Use `getParticipants` everywhere |
| `getParticipantDetails` | ❌ Missing | ⚠️ Add to mobile | Detailed participant info |
| `getParticipantAge` | ❌ Missing | ⚠️ Add to mobile | Age calculation helper |
| `getParticipants` | `getParticipants` | ✅ Aligned | - |
| `createParticipant` | `createParticipant` | ✅ Aligned | - |
| `updateParticipant` | `updateParticipant` | ✅ Aligned | - |
| `deleteParticipant` | `deleteParticipant` | ✅ Aligned | - |

**Recommendation:**
- Standardize on `getParticipants` (plural) for collection
- Standardize on `getParticipant` (singular) for single item
- Add missing detail helpers to mobile

---

### Guardians / Parents

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `getGuardians` | ❌ Missing | ⚠️ Add to mobile | All guardians |
| `fetchGuardians` | ❌ Missing | ⚠️ Add to mobile | **Duplicate of above** - consolidate |
| `getGuardianInfo` | ❌ Missing | ⚠️ Add to mobile | Guardian details |
| `getGuardianCoreInfo` | ❌ Missing | ⚠️ Add to mobile | Core guardian info |
| `getGuardiansForParticipant` | ❌ Missing | ⚠️ Add to mobile | Participant's guardians |
| `saveParent` | ❌ Missing | ⚠️ Add to mobile | Legacy parent save |
| `saveGuardian` | ❌ Missing | ⚠️ Add to mobile | Guardian save |
| `saveGuardianFormSubmission` | ❌ Missing | ⚠️ Add to mobile | Form submission |
| `linkParentToParticipant` | ❌ Missing | ⚠️ Add to mobile | Parent linking |
| `linkGuardianToParticipant` | ❌ Missing | ⚠️ Add to mobile | Guardian linking |
| `removeGuardians` | ❌ Missing | ⚠️ Add to mobile | Guardian removal |
| `fetchParents` | ❌ Missing | ⚠️ Add to mobile | All parents |
| `getParentUsers` | ❌ Missing | ⚠️ Add to mobile | Parent user accounts |
| `getParentDashboard` | ❌ Missing | ⚠️ Add to mobile | Parent dashboard data |
| `getUserChildren` | ❌ Missing | ⚠️ Add to mobile | User's children |

**Recommendation:**
- Mobile is missing entire guardian/parent domain
- Add comprehensive guardian API coverage
- Consolidate `getGuardians` and `fetchGuardians` (prefer `get*`)

---

### Groups

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `addGroup` | `createGroup` | 🔄 Normalize | **Recommend:** Use `createGroup` (REST convention) |
| `removeGroup` | `deleteGroup` | 🔄 Normalize | **Recommend:** Use `deleteGroup` (REST convention) |
| `updateGroupName` | `updateGroup` | 🔄 Normalize | **Recommend:** Use `updateGroup` (more generic) |
| `updateParticipantGroup` | ❌ Missing | ⚠️ Add to mobile | Assign participant to group |
| `getGroups` | `getGroups` | ✅ Aligned | - |

**Recommendation:**
- Normalize to REST conventions: `createGroup`, `updateGroup`, `deleteGroup`
- Update SPA to match mobile conventions
- Add `updateParticipantGroup` to mobile

---

### Activities

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `getActivities` | `getActivities` | ✅ Aligned | - |
| `getActivity` | `getActivity` | ✅ Aligned | - |
| `createActivity` | `createActivity` | ✅ Aligned | - |
| `updateActivity` | `updateActivity` | ✅ Aligned | - |
| `deleteActivity` | `deleteActivity` | ✅ Aligned | - |
| `getActivitesRencontre` | `getMeetingActivities` | 🔄 Normalize | **Recommend:** Use `getMeetingActivities` |

**Recommendation:**
- Excellent alignment!
- Rename `getActivitesRencontre` to `getMeetingActivities` in SPA for English consistency

---

### Finance

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `getFinanceReport` | `getFinanceSummary` | 🔄 Normalize | **Recommend:** Use `getFinanceSummary` |
| `getParticipantStatement` | `getParticipantStatement` | ✅ Aligned | **NEWLY ADDED** |
| `getFeeDefinitions` | `getFeeDefinitions` | ✅ Aligned | - |
| `createFeeDefinition` | `createFeeDefinition` | ✅ Aligned | - |
| `updateFeeDefinition` | ❌ Missing | ⚠️ Add to mobile | - |
| `deleteFeeDefinition` | ❌ Missing | ⚠️ Add to mobile | - |
| `getParticipantFees` | `getParticipantFees` | ✅ Aligned | - |
| `createParticipantFee` | ❌ Missing | ⚠️ Add to mobile | - |
| `updateParticipantFee` | ❌ Missing | ⚠️ Add to mobile | - |
| `getParticipantPayments` | ❌ Missing | ⚠️ Add to mobile | - |
| `createParticipantPayment` | ❌ Missing | ⚠️ Add to mobile | - |
| `updatePayment` | ❌ Missing | ⚠️ Add to mobile | - |
| `getPaymentPlans` | ❌ Missing | ⚠️ Add to mobile | - |
| `createPaymentPlan` | ❌ Missing | ⚠️ Add to mobile | - |
| `updatePaymentPlan` | ❌ Missing | ⚠️ Add to mobile | - |
| `deletePaymentPlan` | ❌ Missing | ⚠️ Add to mobile | - |

**Recommendation:**
- Mobile has basic finance coverage but lacks CRUD for most entities
- Add missing finance CRUD operations
- Standardize on `getFinanceSummary` vs `getFinanceReport`

---

### Stripe Payments

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `createStripePaymentIntent` | `createStripePaymentIntent` | ✅ Aligned | **NEWLY ADDED** |
| `getStripePaymentStatus` | `getStripePaymentStatus` | ✅ Aligned | **NEWLY ADDED** |
| ❌ N/A | `createPaymentIntent` | ⚠️ Generic | Mobile has generic payment intent (legacy?) |

**Recommendation:**
- Use `createStripePaymentIntent` for consistency
- Deprecate or rename `createPaymentIntent` if it's Stripe-specific

---

### Risk Acceptance

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `fetchAcceptationRisque` | `getRiskAcceptance` | 🔄 Normalize | **Recommend:** Use `getRiskAcceptance` |
| `saveAcceptationRisque` | `saveRiskAcceptance` | 🔄 Normalize | **Recommend:** Use `saveRiskAcceptance` |

**Recommendation:**
- English naming is clearer
- Update SPA to use `getRiskAcceptance` / `saveRiskAcceptance`

---

### Carpools

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| ❌ Missing | `assignParticipantToCarpool` | ⚠️ Add to SPA | Mobile-first feature |
| ❌ Missing | `createCarpoolOffer` | ⚠️ Add to SPA | Mobile-first feature |
| ❌ Missing | `getCarpoolOffers` | ⚠️ Add to SPA | Mobile-first feature |
| ❌ Missing | `getMyCarpoolOffers` | ⚠️ Add to SPA | Mobile-first feature |
| ❌ Missing | `getMyChildrenAssignments` | ⚠️ Add to SPA | Mobile-first feature |
| ❌ Missing | `getUnassignedParticipants` | ⚠️ Add to SPA | Mobile-first feature |

**Recommendation:**
- Mobile has superior carpool API coverage
- Port mobile carpool endpoints to SPA

---

### Roles & Permissions

| SPA Function | Mobile Function | Status | Notes |
|--------------|----------------|--------|-------|
| `getRoleCatalog` | `getRoles` | 🔄 Normalize | **Recommend:** Use `getRoles` |
| `getRolePermissions` | ❌ Missing | ⚠️ Add to mobile | Permission details |
| `getRoleAuditLog` | ❌ Missing | ⚠️ Add to mobile | Role change audit |
| `updateUserRole` | ❌ Missing | ⚠️ Add to mobile | Legacy role update |
| `updateUserRolesV1` | ❌ Missing | ⚠️ Add to mobile | V1 role update |
| `updateUserRoleBundles` | ❌ Missing | ⚠️ Add to mobile | Role bundle assignment |
| `checkPermission` | ❌ Missing | ⚠️ Add to mobile | Permission check |

**Recommendation:**
- Add comprehensive role/permission management to mobile
- Standardize on `getRoles` vs `getRoleCatalog`

---

## Normalization Action Plan

### Phase 1: Critical Alignments (High Priority)

1. **Participants:**
   - SPA: Rename `fetchParticipants` → `getParticipants`
   - SPA: Rename `fetchParticipant` → `getParticipant`

2. **Groups:**
   - SPA: Rename `addGroup` → `createGroup`
   - SPA: Rename `removeGroup` → `deleteGroup`
   - SPA: Rename `updateGroupName` → `updateGroup`

3. **Activities:**
   - SPA: Rename `getActivitesRencontre` → `getMeetingActivities`

4. **Risk Acceptance:**
   - SPA: Rename `fetchAcceptationRisque` → `getRiskAcceptance`
   - SPA: Rename `saveAcceptationRisque` → `saveRiskAcceptance`

5. **Finance:**
   - SPA: Rename `getFinanceReport` → `getFinanceSummary`

### Phase 2: Fill Coverage Gaps (Medium Priority)

6. **Mobile: Add Guardian/Parent APIs**
   - Port all guardian/parent endpoints from SPA to mobile
   - Critical for parent-facing features

7. **Mobile: Add Finance CRUD**
   - Add fee definition update/delete
   - Add participant fee create/update
   - Add payment plan CRUD
   - Add payment create/update

8. **SPA: Add Carpool APIs**
   - Port mobile carpool endpoints to SPA
   - Align carpool feature parity

9. **Mobile: Add Role Management**
   - Add role permission management
   - Add audit log access

### Phase 3: Advanced Features (Low Priority)

10. **Auth Helpers**
    - Add auth validation helpers to mobile

11. **Reporting APIs**
    - Add health/attendance/document reports to mobile

---

## Naming Conventions (Going Forward)

### REST Operations
- **List/Collection:** `get{Resource}s` (plural) - e.g., `getParticipants`
- **Single Item:** `get{Resource}` (singular) - e.g., `getParticipant`
- **Create:** `create{Resource}` - e.g., `createParticipant`
- **Update:** `update{Resource}` - e.g., `updateParticipant`
- **Delete:** `delete{Resource}` - e.g., `deleteParticipant`

### Specialized Operations
- **Custom queries:** `get{Resource}By{Criteria}` - e.g., `getParticipantsByGroup`
- **Actions:** `{verb}{Resource}` - e.g., `assignParticipantToCarpool`
- **Bulk operations:** `{verb}Bulk{Resource}` - e.g., `updateBulkParticipants`

### Avoid
- ❌ French names in English codebase (use English consistently)
- ❌ `fetch*` prefix (prefer `get*` for consistency with REST)
- ❌ `save*` prefix (use `create*` or `update*` explicitly)

---

## Migration Strategy

### For SPA Refactoring
1. Create aliases for old function names pointing to new names
2. Mark old names as `@deprecated` with migration notice
3. Update internal SPA code to use new names
4. Remove deprecated aliases in next major version

Example:
```javascript
/**
 * @deprecated Use getParticipants instead
 */
export const fetchParticipants = getParticipants;
```

### For Mobile Additions
1. Add missing functions following new naming conventions
2. Export immediately (no aliases needed)
3. Document in release notes

---

## Tracking Progress

- [ ] Phase 1: Critical Alignments
  - [ ] Participants naming
  - [ ] Groups naming
  - [ ] Activities naming
  - [ ] Risk acceptance naming
  - [ ] Finance naming

- [ ] Phase 2: Coverage Gaps
  - [ ] Guardian/parent APIs in mobile
  - [ ] Finance CRUD in mobile
  - [ ] Carpool APIs in SPA
  - [ ] Role management in mobile

- [ ] Phase 3: Advanced Features
  - [ ] Auth helpers in mobile
  - [ ] Reporting APIs in mobile

---

## References

- SPA API Endpoints: `/spa/api/api-endpoints.js`
- Mobile API Endpoints: `/mobile/src/api/api-endpoints.js`
- Porting Status: `/mobile/devdocs/spa-to-mobile-porting-status.md`
- Backend Routes: `/routes/*.js`
