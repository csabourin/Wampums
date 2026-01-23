# SPA ↔ Mobile Feature Parity Checklist

**Generated:** 2026-01-23
**Purpose:** Track feature parity and improvements between the web SPA (`/spa`) and React Native mobile app (`/mobile`)

---

## Quick Stats

| Metric | SPA | Mobile | Notes |
|--------|-----|--------|-------|
| **Screens/Pages** | 64 | 57 | Mobile is missing some admin/tooling pages |
| **API Endpoints** | 218 | 105+ | Mobile needs ~100 more API wrappers |
| **Utility Modules** | 18+ | 15 | Core utilities aligned |
| **Languages** | 5 | 5 | Both: en, fr, uk, it, id |
| **Offline Support** | IndexedDB + SW | AsyncStorage + CacheManager | Different implementations |

---

## Legend

- ✅ **Complete** - Feature exists with full parity
- ⚠️ **Partial** - Feature exists but incomplete or needs verification
- ❌ **Missing** - Feature absent, needs implementation
- 🔄 **Different Approach** - Platform-specific implementation
- 💡 **Improvement** - Enhancement opportunity for both platforms

---

## 1. Authentication & Session Management

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Email/password login | ✅ | ✅ | ✅ | None |
| 2FA verification | ✅ | ✅ | ✅ | None |
| Device trust for 2FA | ❌ | ✅ | ❌ SPA | Add device trust to SPA |
| Password reset flow | ✅ | ✅ | ✅ | None |
| Email verification | ✅ | ⚠️ | ⚠️ | Verify mobile has email verification |
| JWT token management | ✅ | ✅ | ✅ | None |
| Auto-logout on 401 | ✅ | ✅ | ✅ | None |
| Session validation | ✅ | ✅ | ✅ | None |
| Organization selection | ✅ | ✅ | ✅ | Mobile has dedicated OrganizationSelectScreen |
| Organization slug resolution | ⚠️ | ✅ | ⚠️ | SPA may use different flow |
| User approval workflow | ✅ | ⚠️ | ⚠️ | Verify mobile admin has approval UI |

---

## 2. Dashboards

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Main dashboard | ✅ | ✅ | ✅ | None |
| Parent dashboard | ✅ | ✅ | ✅ | None |
| Leader dashboard | ⚠️ | ✅ | 🔄 | SPA combines into main dashboard |
| District dashboard | ✅ | ✅ | ✅ | None |
| Admin panel | ✅ | ✅ | ✅ | None |
| Activity widget on dashboard | ✅ | ❌ | ❌ Mobile | Add activity widget to mobile dashboard |
| News feed display | ✅ | ⚠️ | ⚠️ | Verify mobile shows news |
| Quick statistics | ✅ | ✅ | ✅ | None |
| Points tracking display | ✅ | ✅ | ✅ | None |
| Settings page | ⚠️ | ✅ | ❌ SPA | SPA lacks dedicated settings page |

---

## 3. Participant Management

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| View participants list | ✅ | ✅ | ✅ | None |
| Create participant | ✅ | ✅ | ✅ | None |
| Edit participant | ✅ | ✅ | ✅ | None |
| Delete participant | ✅ | ✅ | ✅ | None |
| Participant detail view | ✅ (modal/route) | ✅ (screen) | 🔄 | Different UI patterns |
| Photo uploads | ✅ | ⚠️ | ⚠️ | Verify mobile photo upload |
| Document tracking | ✅ | ✅ | ✅ | None |
| Participant groups | ✅ | ✅ | ✅ | None |
| Multi-role support | ✅ | ✅ | ✅ | None |
| Age calculation | ✅ | ✅ | ✅ | None |
| Search & filtering | ✅ | ✅ | ✅ | None |
| Link user to participant | ✅ | ✅ | ✅ | None |
| Multiple guardians per participant | ✅ | ⚠️ | ⚠️ | Verify mobile guardian management |

---

## 4. Health & Safety

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Health form (Fiche Santé) | ✅ | ✅ | ✅ | None |
| Risk acceptance form | ✅ | ✅ | ✅ | None |
| Medication requirements | ✅ | ✅ | ✅ | None |
| Allergy tracking | ✅ | ✅ | ✅ | None |
| Vaccination records | ✅ | ⚠️ | ⚠️ | Verify mobile vaccine tracking |
| Media authorization | ✅ | ⚠️ | ⚠️ | Verify mobile media auth tracking |
| "Leave Alone" restrictions | ✅ | ⚠️ | ⚠️ | Verify mobile leave alone feature |
| Medication planning view | ✅ | ✅ | ✅ | None |
| Medication dispensing | ✅ | ✅ | ✅ | None |
| Medication alerts | ✅ | ⚠️ | ⚠️ | Verify mobile medication alerts |
| Time-slot aggregated alerts | ✅ | ⚠️ | ⚠️ | Verify mobile alert grouping |

---

## 5. Attendance

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Mark attendance (present/late/absent/excused) | ✅ | ✅ | ✅ | None |
| Date-based records | ✅ | ✅ | ✅ | None |
| Attendance dates management | ✅ | ✅ | ✅ | None |
| Guest addition for non-members | ✅ | ⚠️ | ⚠️ | Verify mobile guest support |
| Attendance reports | ✅ | ✅ | ✅ | None |

---

## 6. Activities & Calendar

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| View activities list | ✅ | ✅ | ✅ | None |
| Create activity | ✅ | ✅ | ✅ | None |
| Edit activity | ✅ | ✅ | ✅ | None |
| Delete activity | ✅ | ✅ | ✅ | None |
| Activity detail screen | ✅ | ✅ | ✅ | None |
| Calendar view | ✅ | ✅ | ✅ | None |
| Activity filtering | ✅ | ✅ | ✅ | None |
| Activity widget (embeddable) | ✅ | ❌ | ❌ Mobile | Not applicable for mobile |
| Participant list per activity | ✅ | ✅ | ✅ | None |

---

## 7. Meetings

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Upcoming meeting view | ✅ | ✅ | ✅ | None |
| Meeting preparation | ✅ | ✅ | ✅ | None |
| Activity planning for meetings | ✅ | ✅ | ✅ | None |
| Animator (leader) assignment | ✅ | ⚠️ | ⚠️ | Verify mobile animator assignment |
| Meeting section configuration | ✅ | ⚠️ | ⚠️ | Verify program-specific sections |

---

## 8. Badges & Honors

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Badge dashboard | ✅ | ✅ | ✅ | None |
| Badge tracker | ✅ | ✅ | ✅ | None |
| Badge progress updates | ✅ | ✅ | ✅ | None |
| Badge approval workflow | ✅ | ✅ | ✅ | None |
| Badge form submission | ✅ | ✅ | ✅ | None |
| Custom badge configuration | ✅ | ⚠️ | ⚠️ | Verify mobile custom badges |
| Honor awards | ✅ | ✅ | ✅ | None |
| Honor approval workflow | ✅ | ⚠️ | ⚠️ | Verify mobile honor approval |
| Honors/points integration | ✅ | ⚠️ | ⚠️ | Verify mobile integration |
| Time-based honor tracking | ✅ | ⚠️ | ⚠️ | Verify mobile time tracking |

---

## 9. Points System

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Point definitions/configuration | ✅ | ⚠️ | ⚠️ | Verify mobile point config |
| Participant point tracking | ✅ | ✅ | ✅ | None |
| Quick point actions (+/-) | ✅ | ✅ | ✅ | Mobile has +1/3/5, -1/3/5 |
| Attendance point allocation | ✅ | ⚠️ | ⚠️ | Verify mobile attendance points |
| Badge/honor point awards | ✅ | ⚠️ | ⚠️ | Verify mobile badge points |
| Point history | ✅ | ⚠️ | ⚠️ | Verify mobile point history |
| Points report | ✅ | ✅ | ✅ | None |
| Points leaderboard | ✅ | ✅ | ✅ | None |

---

## 10. Carpool System

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Carpool landing page | ✅ | ⚠️ | ⚠️ | Mobile has single CarpoolScreen |
| Carpool dashboard (activity-specific) | ✅ | ⚠️ | ⚠️ | May be combined in mobile |
| Driver management | ✅ | ✅ | ✅ | None |
| Participant assignment | ✅ | ✅ | ✅ | None |
| Trip direction options | ✅ | ✅ | ✅ | None |
| Carpool reservations | ✅ | ⚠️ | ⚠️ | Verify mobile reservations |
| Create carpool offer | ✅ | ✅ | ✅ | None |
| View my offers | ✅ | ✅ | ✅ | None |
| View children's assignments | ✅ | ✅ | ✅ | None |

---

## 11. Finance Module

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Fee definitions CRUD | ✅ | ✅ | ✅ | None |
| Participant fee tracking | ✅ | ✅ | ✅ | None |
| Payment recording | ✅ | ✅ | ✅ | None |
| Payment plans (installments) | ✅ | ✅ | ✅ | None |
| Payment history | ✅ | ✅ | ✅ | None |
| Stripe integration | ✅ | ✅ | ✅ | None |
| Participant statements | ✅ | ✅ | ✅ | None |
| Parent finance view | ✅ | ✅ | ✅ | None |
| Finance reports | ✅ | ⚠️ | ⚠️ | Verify mobile finance reports |

---

## 12. Budget Management

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Budget categories CRUD | ✅ | ⚠️ | ⚠️ | Verify mobile category CRUD |
| Budget items CRUD | ✅ | ⚠️ | ⚠️ | Verify mobile item CRUD |
| Budget planning | ✅ | ✅ | ✅ | None |
| Budget plans CRUD | ✅ | ⚠️ | ⚠️ | Verify mobile plan CRUD |
| Fiscal year management | ✅ | ⚠️ | ⚠️ | Verify mobile fiscal year |
| Budget summary report | ✅ | ⚠️ | ⚠️ | Verify mobile budget reports |

---

## 13. Expenses

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Expense tracking | ✅ | ✅ | ✅ | None |
| Expense CRUD | ✅ | ✅ | ✅ | None |
| Monthly breakdowns | ✅ | ✅ | ✅ | None |
| Bulk expense entry | ✅ | ✅ | ✅ | None |
| Expense reports | ✅ | ⚠️ | ⚠️ | Verify mobile expense reports |
| Receipt scanning (OCR) | ✅ | ❌ | ❌ Mobile | Add receipt scanning to mobile |

---

## 14. Revenue

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Revenue dashboard | ✅ | ✅ | ✅ | None |
| External revenue tracking | ✅ | ✅ | ✅ | None |
| Revenue sources | ✅ | ⚠️ | ⚠️ | Verify mobile revenue sources |
| Revenue summary reports | ✅ | ⚠️ | ⚠️ | Verify mobile revenue reports |
| Revenue comparison analysis | ✅ | ⚠️ | ⚠️ | Verify mobile comparison |

---

## 15. Fundraisers

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Fundraiser CRUD | ✅ | ✅ | ✅ | None |
| Calendar entries | ✅ | ✅ | ✅ | None |
| Payment tracking per entry | ✅ | ✅ | ✅ | None |
| Fundraiser archiving | ✅ | ⚠️ | ⚠️ | Verify mobile archiving |

---

## 16. Inventory & Resources

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Equipment inventory CRUD | ✅ | ✅ | ✅ | None |
| Equipment photos | ✅ | ⚠️ | ⚠️ | Verify mobile photo upload |
| Image optimization (WebP) | ✅ | ❌ | ❌ Mobile | Add image optimization |
| HEIC/HEIF conversion | ✅ | ❌ | ❌ Mobile | Add HEIC support |
| Equipment reservations | ✅ | ✅ | ✅ | None |
| Bulk reservations | ✅ | ⚠️ | ⚠️ | Verify mobile bulk reservations |
| Material management | ✅ | ✅ | ✅ | None |
| Resource dashboard | ✅ | ✅ | ✅ | None |

---

## 17. Permission Slips

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Permission slip CRUD | ✅ | ✅ | ✅ | Mobile has savePermissionSlip API |
| Permission slip signing | ✅ | ✅ | ✅ | None |
| Token-based public signing | ✅ | ✅ | ✅ | None |
| Status tracking | ✅ | ✅ | ✅ | None |
| Email distribution | ✅ | ✅ | ✅ | Mobile has sendPermissionSlipEmails API |
| Email reminders | ✅ | ✅ | ✅ | Mobile has sendPermissionSlipReminders API |
| Permission slip archiving | ✅ | ✅ | ✅ | Mobile has archivePermissionSlip API |
| Multi-activity support | ✅ | ⚠️ | ⚠️ | Verify mobile multi-activity |

---

## 18. Communication

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Mailing list management | ✅ | ✅ | ✅ | None |
| Parent contact list | ✅ | ✅ | ✅ | None |
| Announcements | ✅ | ⚠️ | ⚠️ | Mobile has basic announcements (MailingListScreen); verify parity (edit/delete, filters, notifications) |
| WhatsApp integration (Baileys) | ✅ | ❌ | ❌ Mobile | Consider mobile WhatsApp |

---

## 19. Forms & Form Builder

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Form builder (drag-and-drop) | ✅ | ❌ | ❌ Mobile | Complex; may not be mobile-appropriate |
| Dynamic form rendering | ✅ | ✅ | ✅ | Mobile has DynamicFormRenderer |
| Form submission | ✅ | ✅ | ✅ | None |
| Registration form | ✅ | ✅ | ✅ | None |
| Guardian forms | ✅ | ⚠️ | ⚠️ | Verify mobile guardian forms |
| Conditional field logic | ✅ | ✅ | ✅ | Mobile supports dependsOn-based conditional visibility |
| Multi-language form definitions | ✅ | ✅ | ✅ | None |
| Rich text editor (WYSIWYG) | ✅ | ❌ | ❌ Mobile | Limited on mobile; may need alternative |
| Form permissions management | ✅ | ✅ | ✅ | None |

---

## 20. Reports & Analytics

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| Reports dashboard | ✅ | ✅ | ✅ | None |
| Report viewer | ✅ | ✅ | ✅ | None |
| Health report | ✅ | ✅ | ✅ | None |
| Allergies report | ✅ | ✅ | ✅ | None |
| Medication report | ✅ | ✅ | ✅ | None |
| Vaccine report | ✅ | ✅ | ✅ | None |
| Media authorization report | ✅ | ⚠️ | ⚠️ | Verify mobile media auth report |
| Missing documents report | ✅ | ✅ | ✅ | None |
| Attendance report | ✅ | ✅ | ✅ | None |
| Honors report | ✅ | ⚠️ | ⚠️ | Verify mobile honors report |
| Points report | ✅ | ✅ | ✅ | None |
| Age distribution report | ✅ | ⚠️ | ⚠️ | Verify mobile age report |
| Time since registration | ✅ | ✅ | ✅ | None |
| Group participant report | ✅ | ✅ | ✅ | None |
| Leave alone report | ✅ | ⚠️ | ⚠️ | Verify mobile leave alone report |
| Print functionality | ✅ | ❌ | 🔄 | Mobile uses OS share/print |

---

## 21. Role & Permission Management

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| View roles and permissions | ✅ | ✅ | ✅ | None |
| Assign roles to users | ✅ | ✅ | ✅ | None |
| User role history/audit log | ✅ | ❌ | ❌ Mobile | Add audit log viewing |
| Permission catalog | ✅ | ⚠️ | ⚠️ | Verify mobile permission catalog |
| Role bundle management | ✅ | ⚠️ | ⚠️ | Verify mobile role bundles |

---

## 22. District Management

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| District admin controls | ✅ | ✅ | ✅ | None |
| Role bundle management | ✅ | ⚠️ | ⚠️ | Verify mobile role bundles |
| Form permission management | ✅ | ✅ | ✅ | None |
| Organization management | ✅ | ✅ | ✅ | None |

---

## 23. Admin Features

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| User management | ✅ | ⚠️ | ⚠️ | Verify mobile user management |
| Organization settings | ✅ | ⚠️ | ⚠️ | Verify mobile org settings |
| SISC data import | ✅ | ❌ | ❌ Mobile | Admin feature; low mobile priority |
| User approval workflow | ✅ | ⚠️ | ⚠️ | Verify mobile user approval |
| Subscriber management | ✅ | ⚠️ | ⚠️ | Verify mobile subscriber mgmt |
| Pending users list | ✅ | ⚠️ | ⚠️ | Verify mobile pending users |

---

## 24. Utilities & Infrastructure

| Utility | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| DateUtils | ✅ | ✅ | ✅ | Verify locale handling parity |
| DebugUtils | ✅ | ✅ | ✅ | None |
| SecurityUtils | ✅ | ✅ | ✅ | None |
| ValidationUtils | ✅ | ✅ | ✅ | None |
| PermissionUtils | ✅ | ✅ | ✅ | None |
| StorageUtils | ✅ | ✅ | 🔄 | Different storage backends |
| OptimisticUpdateManager | ✅ | ✅ | ✅ | None |
| SkeletonUtils | ✅ | ✅ | ✅ | Mobile has Skeleton component |
| CacheManager | IndexedDB | ✅ | 🔄 | Different implementations |
| ParticipantRoleUtils | ✅ | ⚠️ | ⚠️ | Verify mobile version |
| RoleValidationUtils | ✅ | ⚠️ | ⚠️ | Verify mobile version |
| PhoneUtils | ✅ | ✅ | ✅ | None |
| NumberUtils | ⚠️ | ✅ | ⚠️ | SPA may lack NumberUtils |
| FormatUtils | ⚠️ | ✅ | ⚠️ | SPA may lack FormatUtils |
| DOMUtils | ✅ | N/A | 🔄 | Web-only utility |
| BaseModule | ✅ | N/A | 🔄 | SPA module pattern |
| SimpleWYSIWYG | ✅ | ❌ | ❌ | Rich text not on mobile |
| ClientCleanupUtils | ✅ | N/A | 🔄 | SPA-specific |
| PerformanceUtils | ✅ | ⚠️ | ⚠️ | Verify mobile perf utils |
| MeetingPlanUtils | ✅ | ⚠️ | ⚠️ | Verify mobile version |
| ActivityManager | ✅ | ✅ | ✅ | None |

---

## 25. Advanced/Platform-Specific Features

| Feature | SPA | Mobile | Status | Action Required |
|---------|-----|--------|--------|-----------------|
| **Offline Support** | IndexedDB + SW | AsyncStorage + CacheManager | 🔄 | Both have offline, different impl |
| **PWA Support** | ✅ | N/A | 🔄 | Native app instead |
| **Service Worker** | ✅ | N/A | 🔄 | Not applicable |
| **Push Notifications** | Web Push | ⚠️ | ⚠️ | Verify mobile push impl |
| **Install Prompt** | ✅ | N/A | 🔄 | App store instead |
| **Image Optimization** | WebP + HEIC | ⚠️ | ⚠️ | Verify mobile image handling |
| **AI Text Generation** | ✅ | ❌ | ❌ Mobile | Add AI features to mobile |
| **Receipt OCR** | ✅ | ❌ | ❌ Mobile | Add OCR to mobile |
| **Biometric Auth** | ❌ | ✅ (enabled) | ❌ SPA | SPA could use WebAuthn |
| **Secure Token Storage** | localStorage | SecureStore (small keys) + AsyncStorage (JWTs) | 🔄 | Mobile: small keys in SecureStore, JWTs in AsyncStorage (size limits) |
| **Deep Linking** | ✅ (routes) | ⚠️ | ⚠️ | Verify mobile deep links |

---

## 26. API Endpoint Coverage

### Missing in Mobile (High Priority)

| Endpoint Category | Missing Functions | Priority |
|------------------|-------------------|----------|
| **Users/Roles** | getPendingUsers, approveUser, getRoleAuditLog, updateUserRoleBundles | High |
| **Participants** | getParticipantsWithUsers, getParticipantsWithDocuments, removeParticipantFromOrganization | Medium |
| **Guardians** | Guardian management UI (dedicated list/edit screen, link to participant flow) - API exists | Medium |
| **Reports** | getHealthContactReport, getLeaveAloneReport, getMediaAuthorizationReport | Medium |
| **Finance** | getFinanceReport (detailed), getBudgetRevenueBreakdown, getRevenueComparison | Medium |
| **Permission Slips** | Permission slip functions exist - verify UI parity for create/edit/archive flows | Low |
| **Fundraisers** | archiveFundraiser, updateCalendarEntry, updateCalendarPayment | Medium |
| **Announcements** | getAnnouncements, createAnnouncement | Medium |
| **Forms** | getFormTypes, getFormStructure, importSISC | Low |

### Missing in Mobile (Lower Priority)

| Endpoint Category | Missing Functions | Priority |
|------------------|-------------------|----------|
| **Organization** | createOrganization, getSubscribers, registerForOrganization | Low |
| **Auth** | testConnection, testApiConnection, getPublicNews | Low |
| **Points** | getParticipantProgressReport (detailed) | Low |
| **Calendars** | getCalendars, updateCalendar, getParticipantCalendar | Low |

---

## 27. Component Parity

| Component | SPA | Mobile | Notes |
|-----------|-----|--------|-------|
| Button | ✅ | ✅ | Both have variants |
| Card | ✅ | ✅ | |
| Modal | ✅ | ✅ | Including ConfirmModal |
| Toast | ✅ | ✅ | |
| Loading Spinner | ✅ | ✅ | |
| Skeleton Loader | ✅ | ✅ | |
| Form Field | ✅ | ✅ | Multiple input types |
| Select/Dropdown | ✅ | ✅ | |
| Checkbox | ✅ | ✅ | |
| Radio Button | ✅ | ✅ | |
| Table | ✅ | ✅ | |
| SearchBar | ✅ | ✅ | |
| FilterBar | ⚠️ | ✅ | Verify SPA equivalent |
| EmptyState | ✅ | ✅ | Multiple variants |
| ErrorMessage | ✅ | ✅ | |
| StatCard | ⚠️ | ✅ | Verify SPA equivalent |
| QuickActionButton | ⚠️ | ✅ | Verify SPA equivalent |
| DynamicFormRenderer | ✅ | ✅ | |

---

## 28. Improvement Opportunities (Both Platforms)

### Code Quality

| Improvement | SPA | Mobile | Notes |
|-------------|-----|--------|-------|
| TypeScript migration | ❌ | ❌ | Both use vanilla JS |
| Unit test coverage | ⚠️ | ⚠️ | Verify test coverage |
| E2E test coverage | ⚠️ | ⚠️ | Verify E2E tests |
| Error boundary handling | ✅ | ✅ | Mobile has ErrorBoundary |
| Storybook for components | ❌ | ❌ | Would help component docs |

### API Consistency

| Improvement | Notes |
|-------------|-------|
| Normalize API function names | SPA uses `addGroup`, mobile uses `createGroup` |
| Standardize response handling | Both handle differently |
| Share API types/interfaces | No shared type definitions |
| Document API version usage | Mix of v1 and legacy endpoints |

### UX Improvements

| Improvement | SPA | Mobile | Notes |
|-------------|-----|--------|-------|
| Consistent empty states | ⚠️ | ✅ | Mobile has EmptyState variants |
| Consistent loading states | ✅ | ✅ | Both have skeleton/spinner |
| Consistent error handling | ⚠️ | ⚠️ | Could be more consistent |
| Accessibility audit | ⚠️ | ⚠️ | Both need a11y review |
| Dark mode support | ❌ | ⚠️ | Mobile has theme system |

### Performance

| Improvement | SPA | Mobile | Notes |
|-------------|-----|--------|-------|
| Bundle size optimization | ⚠️ | ⚠️ | Review bundle sizes |
| Image lazy loading | ✅ | ⚠️ | Verify mobile lazy loading |
| Virtual lists for large data | ⚠️ | ⚠️ | For participant lists |
| Cache invalidation strategy | ✅ | ✅ | Both have caching |

---

## 29. Priority Matrix

### P0 - Critical (Blocking Issues)

1. ⚠️ **Mobile: Verify guardian management UI parity** - API exists; confirm edit/remove, multiple guardians, and error states match SPA
2. ⚠️ **Mobile: Verify permission slip create/edit flows** - Create/send/archive implemented; validate parity with SPA
3. ⚠️ **Mobile: Verify email verification flow** - Registration may be incomplete

### P1 - High Priority (Core Feature Gaps)

4. ⚠️ **Mobile: Verify announcements feature parity** - Basic support exists in MailingListScreen; check edit/delete/filters
5. ❌ **Mobile: Missing user role audit log viewing** - Admin oversight
6. ⚠️ **Mobile: Verify user approval workflow** - Admin onboarding
7. ❌ **Mobile: Add receipt scanning/OCR** - Finance convenience
8. ⚠️ **Mobile: Verify all report types work** - Leadership visibility

### P2 - Medium Priority (Feature Enhancement)

9. ❌ **SPA: Add device trust for 2FA** - Mobile has it
10. ❌ **SPA: Add dedicated settings page** - Mobile has it
11. ⚠️ **Both: Normalize API endpoint naming** - Maintenance burden
12. ⚠️ **Mobile: Add image optimization** - Upload size/quality
13. ⚠️ **Mobile: Verify push notifications** - Engagement

### P3 - Low Priority (Nice to Have)

14. ❌ **Mobile: Form builder** - Complex; admin-only feature
15. ❌ **Mobile: WhatsApp integration** - Nice to have
16. ❌ **Mobile: AI text generation** - Enhancement
17. ❌ **Mobile: SISC import** - Admin-only
18. ⚠️ **Both: TypeScript migration** - Long-term

---

## 30. Implementation Recommendations

### Short Term (1-2 Sprints)

1. **Verify guardian management UI parity** - API exists; ensure edit/remove flows match SPA
2. **Verify permission slip create/edit/archive flows** - Functions exist; validate UI parity
3. **Verify announcements parity in MailingListScreen** - Basic support exists; check edit/delete/filters
4. **Verify and fix email verification on mobile** - Registration flow

### Medium Term (3-4 Sprints)

5. **Add role audit log viewing to mobile** - Admin transparency
6. **Implement receipt OCR on mobile** - Finance UX
7. **Add device trust to SPA 2FA** - Feature parity
8. **Create dedicated settings page in SPA** - Feature parity
9. **Normalize API function names** - Reduce maintenance

### Long Term (5+ Sprints)

10. **Evaluate TypeScript migration** - Both platforms
11. **Comprehensive accessibility audit** - Both platforms
12. **Dark mode for SPA** - Mobile has theme system
13. **Shared component library documentation** - Storybook or similar

---

## Appendix A: Screen/Page Mapping

| SPA Page | Mobile Screen | Status |
|----------|---------------|--------|
| dashboard.js | DashboardScreen | ✅ |
| login.js | LoginScreen | ✅ |
| admin.js | AdminScreen | ✅ |
| parent_dashboard.js | ParentDashboardScreen | ✅ |
| parent_finance.js | ParentFinanceScreen | ✅ |
| formulaire_inscription.js | RegistrationFormScreen | ✅ |
| attendance.js | AttendanceScreen | ✅ |
| manage_points.js | ManagePointsScreen | ✅ |
| time_since_registration.js | TimeSinceRegistrationScreen | ✅ |
| manage_honors.js | HonorsScreen | ✅ |
| manage_participants.js | ParticipantsScreen | ✅ |
| manage_users_participants.js | UserParticipantLinkScreen | ✅ |
| manage_groups.js | GroupsScreen | ✅ |
| view_participant_documents.js | ParticipantDocumentsScreen | ✅ |
| approve_badges.js | ApproveBadgesScreen | ✅ |
| badge_dashboard.js | BadgeDashboardScreen | ✅ |
| badge_tracker.js | BadgeTrackerScreen | ✅ |
| badge_form.js | BadgeFormScreen | ✅ |
| parent_contact_list.js | ParentContactListScreen | ✅ |
| mailing_list.js | MailingListScreen | ✅ |
| fiche_sante.js | HealthFormScreen | ✅ |
| acceptation_risque.js | RiskAcceptanceScreen | ✅ |
| register.js | RegisterScreen | ✅ |
| fundraisers.js | FundraisersScreen | ✅ |
| calendars.js | CalendarScreen | ✅ |
| reset_password.js | ResetPasswordScreen | ✅ |
| reports.js | ReportsScreen | ✅ |
| preparation_reunions.js | MeetingPreparationScreen | ✅ |
| register_organization.js | RegisterOrganizationScreen | ✅ |
| create_organization.js | CreateOrganizationScreen | ✅ |
| group-participant-report.js | GroupParticipantReportScreen | ✅ |
| upcoming_meeting.js | NextMeetingScreen | ✅ |
| finance.js | FinanceScreen | ✅ |
| budgets.js | BudgetsScreen | ✅ |
| external-revenue.js | ExternalRevenueScreen | ✅ |
| expenses.js | ExpensesScreen | ✅ |
| revenue-dashboard.js | RevenueDashboardScreen | ✅ |
| resource_dashboard.js | ResourceDashboardScreen | ✅ |
| inventory.js | InventoryScreen | ✅ |
| material_management.js | MaterialManagementScreen | ✅ |
| medication_management.js | MedicationPlanningScreen | ✅ |
| (medication dispensing) | MedicationDistributionScreen | ✅ |
| permission_slip_dashboard.js | PermissionSlipsScreen | ✅ |
| permission_slip_sign.js | PermissionSlipSignScreen | ✅ |
| modules/account-info.js | AccountInfoScreen | ✅ |
| activities.js | ActivitiesScreen | ✅ |
| carpool.js | CarpoolScreen | ⚠️ |
| carpool_dashboard.js | (combined in CarpoolScreen) | ⚠️ |
| role_management.js | RoleManagementScreen | ✅ |
| district_management.js | DistrictDashboardScreen | ✅ |
| form_permissions.js | FormPermissionsScreen | ✅ |
| formBuilder.js | ❌ None | ❌ |
| dynamicFormHandler.js | (handled in form screens) | 🔄 |
| init-activity-widget.js | ❌ None (N/A) | 🔄 |
| N/A | SettingsScreen | Mobile-only |
| N/A | LeaderDashboardScreen | Mobile-only |
| N/A | OrganizationSelectScreen | Mobile-only |
| N/A | ParticipantDetailScreen | Mobile-only |
| N/A | ActivityDetailScreen | Mobile-only |
| N/A | MedicationScreen | Mobile-only |
| N/A | ReportViewerScreen | Mobile-only |

---

## Appendix B: Verification Checklist

Use this checklist to verify items marked with ⚠️:

**Already Verified:**
- [x] Mobile conditional field logic works (DynamicFormRenderer has dependsOn support)
- [x] Mobile guardian API endpoints exist (getGuardians, saveGuardian, linkGuardianToParticipant, removeGuardians)
- [x] Mobile permission slip APIs exist (save, archive, sendEmails, sendReminders)
- [x] Mobile announcements basic support exists (MailingListScreen uses v1/announcements)

**Needs Verification:**

- [ ] Mobile email verification flow works
- [ ] Mobile admin has user approval UI
- [ ] Mobile shows news on dashboard
- [ ] Mobile photo upload for participants works
- [ ] Mobile guardian management works
- [ ] Mobile vaccine tracking works
- [ ] Mobile media authorization tracking works
- [ ] Mobile "leave alone" feature works
- [ ] Mobile medication alerts work
- [ ] Mobile guest support in attendance works
- [ ] Mobile animator assignment works
- [ ] Mobile meeting sections configuration works
- [ ] Mobile custom badges work
- [ ] Mobile honor approval workflow works
- [ ] Mobile honors/points integration works
- [ ] Mobile point configuration works
- [ ] Mobile attendance points work
- [ ] Mobile point history works
- [ ] Mobile carpool reservations work
- [ ] Mobile finance reports work
- [ ] Mobile budget category CRUD works
- [ ] Mobile fiscal year management works
- [ ] Mobile expense reports work
- [ ] Mobile revenue comparison works
- [ ] Mobile fundraiser archiving works
- [ ] Mobile equipment photo upload works
- [ ] Mobile bulk reservations work
- [x] Mobile permission slip CRUD works (API verified: savePermissionSlip)
- [x] Mobile permission slip archiving works (API verified: archivePermissionSlip)
- [ ] Mobile push notifications work
- [ ] Mobile image optimization works
- [ ] Mobile deep linking works

---

*Document generated from codebase analysis. Last updated: 2026-01-23 (revised after code review)*
