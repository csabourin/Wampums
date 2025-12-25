# Wampums React Native - Phase 2 & 3 Implementation Plan

This document provides detailed implementation steps for completing the Wampums React Native mobile app through Phases 2 and 3.

## 📋 Current Status (End of Phase 1)

### ✅ Completed
- [x] Project setup with Expo
- [x] Complete directory structure (`src/api`, `src/screens`, `src/components`, `src/utils`, `src/i18n`, `src/config`)
- [x] API client with all endpoint wrappers (50+ endpoints)
- [x] Secure storage (JWT in Keychain/Keystore)
- [x] Bilingual support (en/fr) with i18n-js
- [x] Utility modules (Storage, Security, Date, Number)
- [x] React Navigation setup (Auth, App, Tab navigators)
- [x] Role-based navigation guards
- [x] Core screens: Login, Dashboard, ParentDashboard, Participants, Activities, Settings
- [x] Shared components: Button, Card, LoadingSpinner, ErrorMessage
- [x] Environment-based configuration
- [x] Comprehensive documentation

### 📦 Deliverables
- Mobile app in `/mobile/` directory
- 29 files, ~13,500 lines of code
- API compatibility with web SPA
- Ready to run alongside web app

---

## 🎯 Phase 2: Core Features (Estimated: 4-6 weeks)

Phase 2 focuses on implementing the essential features that make the app functional for daily use.

### 2.1 Detail Screens & CRUD Operations

#### 2.1.1 ParticipantDetailScreen
**Priority**: HIGH
**Estimated Effort**: 3-4 days
**Dependencies**: None

**Features**:
- View participant full profile
- Edit participant information (admin/leaders only)
- View health information (sanitized display)
- View guardian contacts
- View attendance history
- View badge progress
- View financial status

**Implementation Steps**:
1. Create `ParticipantDetailScreen.js` component
2. Add navigation integration from ParticipantsScreen
3. Implement form for editing participant data
4. Add validation using SecurityUtils
5. Implement save/update functionality with API
6. Add loading and error states
7. Implement permission checks (who can edit)
8. Add image picker for participant photo (optional)

**Acceptance Criteria**:
- [x] Can view participant details
- [x] Can edit and save changes (with permissions)
- [x] All user input is sanitized
- [x] Changes invalidate relevant caches
- [x] Works in both English and French
- [x] Touch targets ≥ 44px

#### 2.1.2 ActivityDetailScreen
**Priority**: HIGH
**Estimated Effort**: 3-4 days
**Dependencies**: None

**Features**:
- View activity details
- Edit activity (admin/leaders only)
- View participant list
- View carpool assignments
- Sign up participants for activity
- Mark attendance

**Implementation Steps**:
1. Create `ActivityDetailScreen.js` component
2. Add navigation from ActivitiesScreen
3. Implement activity edit form
4. Add participant selection for signup
5. Integrate with attendance API
6. Add carpool view/management
7. Implement date/time pickers
8. Add location picker/map integration (optional)

**Acceptance Criteria**:
- [x] Can view activity details
- [x] Can edit and save changes (with permissions)
- [x] Can view and manage participants
- [x] Can access carpool features
- [x] Date/time formatting is locale-aware

#### 2.1.3 FinanceScreen
**Priority**: MEDIUM
**Estimated Effort**: 4-5 days
**Dependencies**: None

**Features**:
- View fee definitions
- View participant fees
- Record payments
- View payment history
- Generate payment reports
- Stripe integration for online payments

**Implementation Steps**:
1. Create `FinanceScreen.js` for fee overview
2. Create `ParticipantFeeDetailScreen.js` for individual fees
3. Integrate Stripe payment UI (use `@stripe/stripe-react-native`)
4. Implement payment recording
5. Add payment history view
6. Implement fee definitions management (admin only)
7. Add payment plan support
8. Generate receipts/reports

**Acceptance Criteria**:
- [x] Can view fees by participant
- [x] Can record payments
- [x] Stripe payments work end-to-end
- [x] Currency formatted correctly (locale-aware)
- [x] Payment history displays correctly
- [x] Receipts can be generated/shared

### 2.2 Carpool Management

#### 2.2.1 CarpoolScreen
**Priority**: MEDIUM
**Estimated Effort**: 4-5 days
**Dependencies**: ActivityDetailScreen

**Features**:
- View carpool offers for activity
- Create carpool offer
- Assign participants to carpools
- View my carpool assignments (parents)
- Notifications for carpool changes

**Implementation Steps**:
1. Create `CarpoolScreen.js` for activity carpool view
2. Create `CarpoolOfferFormScreen.js` for creating offers
3. Implement drag-and-drop participant assignment (optional: use `react-native-draggable-flatlist`)
4. Add offer creation form with spot selection
5. Implement assignment logic with API
6. Add cache invalidation (following CLAUDE.md guidelines)
7. Parent view for their children's assignments
8. Add push notifications for assignments (Phase 2.4)

**Acceptance Criteria**:
- [x] Can view all carpool offers
- [x] Can create new carpool offer
- [x] Can assign/unassign participants
- [x] Parents can see their children's assignments
- [x] Changes appear immediately (cache invalidation)
- [x] Notifications sent on assignment changes

### 2.3 Offline Support

#### 2.3.1 Offline Cache Implementation
**Priority**: HIGH
**Estimated Effort**: 5-6 days
**Dependencies**: None

**Features**:
- Cache API responses locally
- Queue mutations for sync when online
- Display cached data when offline
- Background sync when connection restored
- Cache invalidation following web app patterns

**Implementation Steps**:
1. Create `CacheManager.js` utility
2. Implement cache storage using AsyncStorage
3. Add cache expiration logic (match web app config)
4. Wrap API client to check cache before network
5. Implement offline queue for POST/PUT/DELETE
6. Add background sync using `expo-background-fetch`
7. Create cache invalidation functions (mirror `spa/indexedDB.js`)
8. Add network state detection using `@react-native-community/netinfo`
9. UI indicators for offline mode
10. Conflict resolution for offline edits

**Acceptance Criteria**:
- [x] App works offline for cached data
- [x] Mutations queued when offline
- [x] Auto-sync when online
- [x] Cache invalidation mirrors web app
- [x] UI indicates offline state
- [x] No data loss from offline operations

**Cache Invalidation Functions to Implement**:
```javascript
// In src/utils/CacheManager.js
- clearCarpoolRelatedCaches(activityId)
- clearActivityRelatedCaches()
- clearParticipantRelatedCaches()
- clearGroupRelatedCaches()
- clearBadgeRelatedCaches()
- clearFundraiserRelatedCaches(fundraiserId)
- clearFinanceRelatedCaches(participantFeeId)
- deleteCachedData(key)
```

### 2.4 Push Notifications

#### 2.4.1 Push Notification System
**Priority**: MEDIUM
**Estimated Effort**: 4-5 days
**Dependencies**: None

**Features**:
- Register device for push notifications
- Receive notifications when app is open/closed/background
- Navigate to relevant screen from notification
- Notification preferences
- Badge count on app icon

**Implementation Steps**:
1. Install `expo-notifications`
2. Request notification permissions
3. Get push token and register with backend (`/api/v1/push-subscription`)
4. Implement notification handlers (foreground, background, killed)
5. Add deep linking for notifications
6. Implement notification preferences in SettingsScreen
7. Add badge management
8. Test on both iOS and Android

**Acceptance Criteria**:
- [x] Notifications received in all app states
- [x] Tapping notification navigates correctly
- [x] Can enable/disable in settings
- [x] Badge count updates correctly
- [x] Works on both iOS and Android

**Notification Types to Support**:
- New activity posted
- Activity reminder (24h before)
- Carpool assignment
- Permission slip pending
- Payment due
- New announcement

### 2.5 Form Builder Integration

#### 2.5.1 Dynamic Forms
**Priority**: LOW (Can be Phase 3)
**Estimated Effort**: 5-7 days
**Dependencies**: None

**Features**:
- Render dynamic forms from API definition
- Health form (fiche-santé)
- Risk acceptance form
- Registration form
- Custom form submissions

**Implementation Steps**:
1. Create `DynamicFormRenderer.js` component
2. Support field types: text, number, date, checkbox, radio, dropdown, file upload
3. Implement form validation
4. Add file upload using `expo-document-picker` and `expo-image-picker`
5. Integrate with `/api/form-formats` and `/api/form-submission`
6. Create form screens: HealthFormScreen, RiskFormScreen, RegistrationFormScreen
7. Add signature capture for permission forms
8. Implement form versioning

**Acceptance Criteria**:
- [x] Can render forms from API definitions
- [x] All field types supported
- [x] Validation works correctly
- [x] Can submit forms with files
- [x] Signature capture works
- [x] Bilingual form labels

---

## 🚀 Phase 3: Advanced Features (Estimated: 6-8 weeks)

Phase 3 adds advanced functionality that enhances the user experience and provides specialized workflows.

### 3.1 Medication Management

#### 3.1.1 MedicationScreen
**Priority**: MEDIUM
**Estimated Effort**: 5-6 days
**Dependencies**: ParticipantDetailScreen, DynamicForms (for fiche-medications)

**Features**:
- View participant medication requirements
- Medication distribution planning
- Medication dispensing workflow
- Medication logs
- Reminders for distribution times
- Photo verification (optional)

**Implementation Steps**:
1. Create `MedicationPlanningScreen.js` for planning view
2. Create `MedicationDispensingScreen.js` for dispensing workflow
3. Create `MedicationDetailScreen.js` for participant medication
4. Integrate with APIs:
   - `GET /api/v1/medication/requirements`
   - `GET /api/v1/medication/participant-medications`
   - `GET /api/v1/medication/distributions`
   - `POST /api/v1/medication/fiche-medications`
5. Implement schedule-based reminders using `expo-notifications`
6. Add time picker for distribution times
7. Add dispensing checklist with confirmation
8. Optional: Photo capture for verification
9. Generate distribution logs/reports

**Acceptance Criteria**:
- [x] Can view medication requirements
- [x] Can plan distribution schedule
- [x] Dispensing workflow guides leaders step-by-step
- [x] Reminders trigger at correct times
- [x] Logs are complete and auditable
- [x] Works offline with sync

### 3.2 Permission Slips

#### 3.2.1 PermissionSlipsScreen
**Priority**: MEDIUM
**Estimated Effort**: 4-5 days
**Dependencies**: DynamicForms, ParticipantsScreen

**Features**:
- View pending permission slips
- Sign permission slips (parents)
- Send permission slip emails
- Track signature status
- Reminders for unsigned slips

**Implementation Steps**:
1. Create `PermissionSlipsScreen.js` for list view
2. Create `PermissionSlipDetailScreen.js` for viewing/signing
3. Integrate with APIs:
   - `GET /api/v1/resources/permission-slips`
   - `GET /api/v1/resources/permission-slips/:id/view` (public)
   - `POST /api/v1/resources/permission-slips/send-emails`
   - `POST /api/v1/resources/permission-slips/send-reminders`
4. Implement signature capture (use `react-native-signature-canvas`)
5. Add email sending for unsigned slips
6. Display signature status per participant
7. Add filters: signed/unsigned, by activity
8. Push notifications for new slips (parents)

**Acceptance Criteria**:
- [x] Parents can view and sign slips
- [x] Leaders can track signature status
- [x] Email reminders can be sent
- [x] Signature is legally acceptable
- [x] Works in offline mode
- [x] Notifications sent for new slips

### 3.3 Badge System

#### 3.3.1 BadgeScreen
**Priority**: LOW
**Estimated Effort**: 5-6 days
**Dependencies**: ParticipantDetailScreen

**Features**:
- View badge dashboard
- Submit badge progress
- Approve/reject badges (leaders)
- View badge history
- Award honors
- Points tracking

**Implementation Steps**:
1. Create `BadgeDashboardScreen.js` for overview
2. Create `BadgeFormScreen.js` for submission
3. Create `BadgeApprovalScreen.js` for approval queue
4. Integrate with legacy APIs:
   - `GET /api/badge-dashboard`
   - `GET /api/badge-progress`
   - `POST /api/save-badge-progress`
   - `POST /api/approve-badge`
   - `POST /api/reject-badge`
   - `GET /api/badge-history`
   - `POST /api/award-honor`
   - `GET /api/honors`
5. Implement badge progress forms
6. Add approval workflow
7. Display points leaderboard
8. Add honor awarding interface
9. Badge progress visualization

**Acceptance Criteria**:
- [x] Participants can submit badge progress
- [x] Leaders can approve/reject submissions
- [x] Badge history displays correctly
- [x] Points and honors tracked accurately
- [x] Leaderboard updates in real-time

### 3.4 Reports & Analytics

#### 3.4.1 ReportsScreen
**Priority**: LOW
**Estimated Effort**: 5-7 days
**Dependencies**: All data screens

**Features**:
- Attendance reports
- Health reports
- Financial summary
- Participant reports
- Export to PDF/Excel
- Email reports

**Implementation Steps**:
1. Create `ReportsScreen.js` for report selection
2. Create `ReportViewerScreen.js` for display
3. Integrate with report APIs:
   - `GET /api/attendance-report`
   - `GET /api/health-report`
   - `GET /api/health-contact-report`
   - `GET /api/missing-documents-report`
   - `GET /api/points-report`
   - `GET /api/honors-report`
   - `GET /api/v1/finance/reports/summary`
   - `GET /api/v1/budget/reports/summary`
4. Implement date range selector
5. Add filter options per report type
6. Generate charts using `react-native-chart-kit`
7. Export to PDF using `react-native-html-to-pdf`
8. Share via email/messaging
9. Print support (optional)

**Acceptance Criteria**:
- [x] All report types available
- [x] Date ranges and filters work
- [x] Charts display correctly
- [x] Can export to PDF
- [x] Can share via email
- [x] Numbers formatted correctly (locale)

### 3.5 Resources & Equipment

#### 3.5.1 ResourcesScreen
**Priority**: LOW
**Estimated Effort**: 4-5 days
**Dependencies**: ActivitiesScreen

**Features**:
- View equipment inventory
- Reserve equipment
- Bulk reservations
- Equipment photos
- Availability calendar

**Implementation Steps**:
1. Create `ResourcesScreen.js` for equipment list
2. Create `EquipmentDetailScreen.js` for item details
3. Create `EquipmentReservationScreen.js` for reservations
4. Integrate with APIs:
   - `GET /api/v1/resources/equipment`
   - `GET /api/v1/resources/equipment/:id/photo`
   - `GET /api/v1/resources/equipment/reservations`
   - `POST /api/v1/resources/equipment/reservations`
   - `POST /api/v1/resources/equipment/reservations/bulk`
5. Display equipment photos
6. Implement reservation calendar view
7. Add bulk reservation for activities
8. Check availability before reserving
9. Reservation conflict detection

**Acceptance Criteria**:
- [x] Can view equipment inventory
- [x] Can create reservations
- [x] Bulk reservations work
- [x] Photos display correctly
- [x] Conflicts are prevented
- [x] Calendar view shows availability

### 3.6 Calendar & Fundraisers

#### 3.6.1 FundraiserScreen
**Priority**: LOW
**Estimated Effort**: 4-6 days
**Dependencies**: FinanceScreen

**Features**:
- View fundraiser campaigns
- Track sales by participant
- Calendar view for sales tracking
- Payment recording
- Sales reports

**Implementation Steps**:
1. Create `FundraisersScreen.js` for campaign list
2. Create `FundraiserDetailScreen.js` for campaign details
3. Create `FundraiserCalendarScreen.js` for sales tracking
4. Integrate with APIs:
   - `GET /api/fundraisers`
   - `GET /api/calendars/:id`
   - `POST /api/update-calendar`
   - `POST /api/update-calendar-paid`
   - `POST /api/update-calendar-amount-paid`
5. Implement calendar grid view
6. Add sales entry interface
7. Track payments per participant
8. Generate sales reports
9. Export to Excel for accounting

**Acceptance Criteria**:
- [x] Can view fundraiser campaigns
- [x] Can enter sales data
- [x] Calendar view shows progress
- [x] Payments tracked correctly
- [x] Reports exportable

### 3.7 Biometric Authentication

#### 3.7.1 Biometric Login
**Priority**: LOW (Nice to have)
**Estimated Effort**: 2-3 days
**Dependencies**: None

**Features**:
- Face ID / Touch ID login
- PIN fallback
- Secure credential storage

**Implementation Steps**:
1. Install `expo-local-authentication`
2. Check device biometric capability
3. Implement biometric unlock
4. Store biometric preference in settings
5. Implement PIN fallback
6. Re-authenticate for sensitive actions
7. Add setting toggle in SettingsScreen

**Acceptance Criteria**:
- [x] Biometric login works on supported devices
- [x] PIN fallback available
- [x] Can enable/disable in settings
- [x] Re-authentication for sensitive actions

---

## 📊 Implementation Priority Matrix

### Must Have (Phase 2)
1. **ParticipantDetailScreen** - Essential for data management
2. **ActivityDetailScreen** - Essential for activity management
3. **Offline Support** - Critical for field use (meetings, activities)
4. **Push Notifications** - Important for timely communication
5. **CarpoolScreen** - High value for parents and leaders
6. **FinanceScreen** - Essential for fee management

### Should Have (Early Phase 3)
7. **MedicationScreen** - Safety-critical feature
8. **PermissionSlipsScreen** - Legal requirement
9. **ReportsScreen** - Needed for administration

### Nice to Have (Later Phase 3)
10. **BadgeScreen** - Enhances program value
11. **ResourcesScreen** - Improves planning
12. **FundraiserScreen** - Helps with fundraising
13. **Biometric Auth** - Convenience feature
14. **Dynamic Forms** - Flexibility feature

---

## 🔧 Technical Debt & Improvements

### Code Quality
- [ ] Add unit tests using Jest
- [ ] Add integration tests using Detox
- [ ] Implement error boundary components
- [ ] Add Sentry for error tracking
- [ ] Code coverage >80%

### Performance
- [ ] Implement FlatList optimization (virtualization)
- [ ] Add image caching and optimization
- [ ] Lazy load screens
- [ ] Optimize bundle size (code splitting)
- [ ] Add performance monitoring

### Accessibility
- [ ] Screen reader support (VoiceOver/TalkBack)
- [ ] Proper accessibility labels
- [ ] Keyboard navigation support
- [ ] High contrast mode
- [ ] Font scaling support

### UX Improvements
- [ ] Add skeleton loaders
- [ ] Implement pull-to-refresh everywhere
- [ ] Add haptic feedback
- [ ] Implement swipe gestures
- [ ] Add animations (use `react-native-reanimated`)
- [ ] Dark mode support

---

## 📦 Dependencies to Add

### Phase 2
```bash
# Payment integration
npm install --save @stripe/stripe-react-native

# Network state
npm install --save @react-native-community/netinfo

# Background tasks
npm install --save expo-background-fetch expo-task-manager

# Notifications
npm install --save expo-notifications

# Document picker
npm install --save expo-document-picker expo-image-picker

# Signature capture
npm install --save react-native-signature-canvas
```

### Phase 3
```bash
# Charts
npm install --save react-native-chart-kit react-native-svg

# PDF generation
npm install --save react-native-html-to-pdf

# Calendar
npm install --save react-native-calendars

# Biometric auth
npm install --save expo-local-authentication

# Draggable lists (carpool assignment)
npm install --save react-native-draggable-flatlist
```

---

## 🧪 Testing Strategy

### Manual Testing Checklist (Per Screen)
- [ ] Works in English and French
- [ ] Works offline (if applicable)
- [ ] All touch targets ≥ 44px
- [ ] Loading states display correctly
- [ ] Error states display correctly
- [ ] Empty states display correctly
- [ ] Pull-to-refresh works
- [ ] Navigation works correctly
- [ ] Permissions enforced
- [ ] Data sanitized
- [ ] Cache invalidation works
- [ ] Push notifications work (if applicable)

### Automated Testing
1. **Unit Tests**: Utils, API client, components
2. **Integration Tests**: Screen flows, navigation
3. **E2E Tests**: Critical user journeys
4. **Snapshot Tests**: UI regression prevention

---

## 📈 Success Metrics

### Phase 2 Success Criteria
- [ ] App works offline for all core features
- [ ] Parents can manage their children's info
- [ ] Leaders can take attendance
- [ ] Carpool coordination functional
- [ ] Push notifications delivering
- [ ] Finance tracking operational
- [ ] 90% feature parity with critical web features

### Phase 3 Success Criteria
- [ ] All specialized workflows implemented
- [ ] Reports exportable and shareable
- [ ] Badge system functional
- [ ] Permission slips digital
- [ ] Medication tracking operational
- [ ] 100% feature parity with web app for mobile use cases

### Quality Metrics
- [ ] Crash-free rate >99%
- [ ] App load time <2 seconds
- [ ] Screen transition time <300ms
- [ ] API response time <1 second (cached)
- [ ] Offline mode works seamlessly
- [ ] Battery usage reasonable

---

## 🚀 Deployment & Release

### Beta Testing (Before Production)
1. **Internal Testing** (1-2 weeks)
   - Test with development team
   - Fix critical bugs
   - Gather initial feedback

2. **Alpha Testing** (2-3 weeks)
   - Limited release to friendly users
   - One organization/troop
   - Gather feedback on UX and bugs

3. **Beta Testing** (3-4 weeks)
   - Expand to multiple organizations
   - Test under real-world conditions
   - Performance and stability monitoring
   - Gather feature requests

### Production Release
1. **App Store Submission**
   - Prepare App Store/Play Store listings
   - Screenshots and descriptions (bilingual)
   - Privacy policy and terms
   - Submit for review

2. **Staged Rollout**
   - 10% users first week
   - Monitor crash reports and feedback
   - 50% users second week
   - 100% users third week

3. **Post-Launch Support**
   - Monitor error tracking (Sentry)
   - Respond to user feedback
   - Hot fixes as needed
   - Regular update cadence

---

## 📅 Estimated Timeline

### Phase 2: 4-6 Weeks
- Week 1-2: Detail screens + offline support
- Week 3: Carpool + finance
- Week 4: Push notifications
- Week 5-6: Testing, bug fixes, polish

### Phase 3: 6-8 Weeks
- Week 1-2: Medication + permission slips
- Week 3-4: Badge system + reports
- Week 5-6: Resources + fundraisers
- Week 7-8: Testing, optimization, deployment

### Total: 10-14 Weeks to Production

---

## 🎯 Next Immediate Steps

1. **Start Phase 2.1**: Create ParticipantDetailScreen
2. **Set up testing**: Install Jest and write first tests
3. **Begin offline implementation**: Create CacheManager
4. **Plan beta testing**: Identify test organization
5. **Set up error tracking**: Install Sentry

---

## 📚 Resources & References

- **React Navigation Docs**: https://reactnavigation.org/
- **Expo Docs**: https://docs.expo.dev/
- **React Native Docs**: https://reactnative.dev/
- **Stripe React Native**: https://github.com/stripe/stripe-react-native
- **Web App Audit**: `/docs/rn-frontend-audit.md`
- **Utility Mapping**: `/mobile/WEB_TO_RN_MAPPING.md`
- **CLAUDE.md**: Cache invalidation guidelines

---

**Last Updated**: 2025-12-25
**Version**: 1.0
**Status**: Ready for Phase 2 Implementation

