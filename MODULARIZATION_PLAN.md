# API Modularization Plan

## Overview
Refactoring api.js (7,406 lines, 106 endpoints) into modular, maintainable route files following Express.js best practices.

## Current Status
- **Total Endpoints**: 106
- **Lines of Code**: 7,406
- **Existing Modular Routes**: 3 (participants, groups, attendance in /routes)
- **Target**: Fully modular architecture with < 300 lines per file

## Module Organization

### 1. Authentication Routes (`routes/auth.js`)
**Endpoints**: 6
- `POST /public/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/request-reset` - Password reset request
- `POST /api/auth/reset-password` - Password reset
- `POST /api/auth/verify-session` - Session verification
- `POST /api/auth/logout` - User logout

### 2. Organization Routes (`routes/organizations.js`)
**Endpoints**: 6
- `GET /api/organization-jwt` - Get organization JWT
- `GET /api/organization-settings` - Get settings
- `POST /api/organizations` - Create organization
- `POST /api/register-for-organization` - Register for org
- `POST /api/switch-organization` - Switch org context
- `GET /public/get_organization_id` - Get org ID (public)

### 3. User Management Routes (`routes/users.js`)
**Endpoints**: 10
- `GET /api/users` - List users
- `GET /api/pending-users` - Pending users
- `GET /api/animateurs` - List animators
- `GET /api/parent-users` - Parent users
- `POST /api/approve-user` - Approve user
- `POST /api/update-user-role` - Update user role
- `POST /api/link-user-participants` - Link user to participants
- `POST /api/associate-user-participant` - Associate user/participant
- `GET /api/user-children` - Get user's children
- `POST /api/permissions/check` - Check permissions

### 4. Participant Routes (`routes/participants.js`) ✅ EXISTS
**Endpoints**: 14 (needs consolidation)
- `GET /api/participants` - List participants
- `GET /api/participants-with-users` - Participants with users
- `GET /api/participants-with-documents` - Participants with docs
- `GET /api/participant-details` - Participant details
- `GET /api/participant-calendar` - Participant calendar
- `GET /api/participant-ages` - Participant ages
- `POST /api/save-participant` - Save participant
- `POST /api/update-participant-group` - Update group
- `POST /api/link-participant-to-organization` - Link to org
- `POST /api/link-parent-participant` - Link parent
- `DELETE /api/participant-groups/:participantId` - Remove from group
- **Already modular**: GET /api/v1/participants, etc. (keep both versions)

### 5. Group Routes (`routes/groups.js`) ✅ EXISTS
**Endpoints**: 4 (needs consolidation)
- `POST /api/groups` - Create group
- `GET /api/groups/:id` - Get group (v1)
- `PUT /api/groups/:id` - Update group
- `DELETE /api/groups/:id` - Delete group
- **Already modular**: GET /api/v1/groups, etc.

### 6. Attendance Routes (`routes/attendance.js`) ✅ EXISTS
**Endpoints**: 4 (needs consolidation)
- `GET /api/attendance` - Get attendance
- `GET /api/attendance-dates` - Get dates
- `POST /api/update-attendance` - Update attendance
- **Already modular**: GET /api/v1/attendance, etc.

### 7. Honor Routes (`routes/honors.js`)
**Endpoints**: 5
- `GET /api/honors` - List honors
- `GET /api/honors-history` - Honor history
- `GET /api/honors-report` - Honor report
- `GET /api/recent-honors` - Recent honors
- `POST /api/award-honor` - Award honor

### 8. Points Routes (`routes/points.js`)
**Endpoints**: 5
- `GET /api/points-data` - Points data
- `GET /api/points-leaderboard` - Leaderboard
- `GET /api/points-report` - Points report
- `POST /api/update-points` - Update points

### 9. Badge Routes (`routes/badges.js`)
**Endpoints**: 9
- `GET /api/badge-progress` - Badge progress
- `GET /api/pending-badges` - Pending badges
- `GET /api/badge-summary` - Badge summary
- `GET /api/badge-history` - Badge history
- `GET /api/current-stars` - Current stars
- `GET /api/badge-system-settings` - Badge settings
- `POST /api/save-badge-progress` - Save progress
- `POST /api/approve-badge` - Approve badge
- `POST /api/reject-badge` - Reject badge
- `PUT /api/badge-progress/:id` - Update progress

### 10. Form Routes (`routes/forms.js`)
**Endpoints**: 10
- `GET /api/form-submission` - Get submission
- `GET /api/form-types` - Get form types
- `GET /api/form-structure` - Get form structure
- `GET /api/form-submissions-list` - List submissions
- `GET /api/form-submissions` - Get submissions
- `GET /api/organization-form-formats` - Org form formats
- `GET /api/risk-acceptance` - Get risk acceptance
- `POST /api/save-form-submission` - Save submission
- `POST /api/risk-acceptance` - Submit risk acceptance
- `POST /api/health-forms` - Submit health form

### 11. Meeting Routes (`routes/meetings.js`)
**Endpoints**: 10
- `GET /api/reunion-preparation` - Get preparation
- `GET /api/reunion-dates` - Get dates
- `GET /api/next-meeting-info` - Next meeting info
- `GET /api/guests-by-date` - Guests by date
- `GET /api/get_reminder` - Get reminder
- `GET /api/activites-rencontre` - Activities
- `GET /api/activity-templates` - Activity templates
- `POST /api/save-reunion-preparation` - Save preparation
- `POST /api/save-guest` - Save guest
- `POST /api/save_reminder` - Save reminder

### 12. Calendar Routes (`routes/calendars.js`)
**Endpoints**: 3
- `GET /api/calendars` - List calendars
- `PUT /api/calendars/:id` - Update calendar
- `PUT /api/calendars/:id/payment` - Update payment

### 13. Guardian Routes (`routes/guardians.js`)
**Endpoints**: 4
- `GET /api/guardians` - List guardians
- `GET /api/parent-contact-list` - Contact list
- `POST /api/save-guardian` - Save guardian
- `DELETE /api/remove-guardian` - Remove guardian

### 14. Notification Routes (`routes/notifications.js`)
**Endpoints**: 3
- `GET /api/push-subscribers` - List subscribers
- `POST /api/push-subscription` - Subscribe
- `POST /api/send-notification` - Send notification

### 15. Report Routes (`routes/reports.js`)
**Endpoints**: 12
- `GET /api/health-report` - Health report
- `GET /api/attendance-report` - Attendance report
- `GET /api/missing-documents-report` - Missing docs report
- `GET /api/health-contact-report` - Health contact report
- `GET /api/allergies-report` - Allergies report
- `GET /api/medication-report` - Medication report
- `GET /api/vaccine-report` - Vaccine report
- `GET /api/leave-alone-report` - Leave alone report
- `GET /api/media-authorization-report` - Media auth report
- `GET /api/mailing-list` - Mailing list

### 16. Dashboard Routes (`routes/dashboards.js`)
**Endpoints**: 2
- `GET /api/initial-data` - Initial data for dashboard
- `GET /api/parent-dashboard` - Parent dashboard data

### 17. Public Routes (`routes/public.js`)
**Endpoints**: 2 (move from main)
- `GET /api/translations` - Get translations
- `GET /api/news` - Get news (public-facing)

### 18. Core Routes (remain in `api.js`)
**Endpoints**: 3
- `GET /` - Serve main app
- `GET /api-docs.json` - Swagger docs JSON
- `GET /api` - Legacy API handler (large switch statement)
- `GET *` - SPA catch-all

## Shared Utilities

### `utils/api-helpers.js`
Extract shared functions from api.js:
- `getCurrentOrganizationId(req)`
- `getUserIdFromToken(token)`
- `getPointSystemRules(organizationId, client)`
- `calculateAttendancePoints(previousStatus, newStatus, rules)`
- `verifyOrganizationMembership(userId, organizationId, requiredRoles)`
- `escapeHtml(text)`

### `middleware/validation.js`
Common validation chains:
- Email validation
- Password strength validation
- ID parameter validation
- Date validation

### `config/database.js`
Extract database pool configuration

## Implementation Order

### Phase 1: Core Infrastructure (Day 1)
1. ✅ Create `utils/api-helpers.js` - Extract shared functions
2. ✅ Create `middleware/validation.js` - Common validations
3. ✅ Update existing route files to use helpers

### Phase 2: High-Value Routes (Day 1-2)
4. ✅ `routes/auth.js` - Authentication (6 endpoints)
5. ✅ `routes/organizations.js` - Organizations (6 endpoints)
6. ✅ `routes/users.js` - User management (10 endpoints)

### Phase 3: Business Logic Routes (Day 2-3)
7. ✅ `routes/honors.js` - Honors (5 endpoints)
8. ✅ `routes/points.js` - Points (5 endpoints)
9. ✅ `routes/badges.js` - Badges (9 endpoints)
10. ✅ `routes/forms.js` - Forms (10 endpoints)

### Phase 4: Supporting Routes (Day 3-4)
11. ✅ `routes/meetings.js` - Meetings (10 endpoints)
12. ✅ `routes/calendars.js` - Calendars (3 endpoints)
13. ✅ `routes/guardians.js` - Guardians (4 endpoints)
14. ✅ `routes/notifications.js` - Notifications (3 endpoints)

### Phase 5: Reports & Dashboard (Day 4)
15. ✅ `routes/reports.js` - Reports (12 endpoints)
16. ✅ `routes/dashboards.js` - Dashboards (2 endpoints)
17. ✅ `routes/public.js` - Public endpoints (2 endpoints)

### Phase 6: Consolidation & Cleanup (Day 4-5)
18. ✅ Update `routes/participants.js` - Consolidate all participant endpoints
19. ✅ Update `routes/groups.js` - Consolidate all group endpoints
20. ✅ Update `routes/attendance.js` - Consolidate all attendance endpoints
21. ✅ Refactor main `api.js` - Import all modules, keep minimal logic
22. ✅ Create comprehensive API documentation

## File Structure

```
/home/user/Wampums/
├── api.js (300 lines - core app setup, imports, catch-all)
├── routes/
│   ├── auth.js (150 lines)
│   ├── organizations.js (180 lines)
│   ├── users.js (250 lines)
│   ├── participants.js (350 lines - consolidated)
│   ├── groups.js (120 lines - consolidated)
│   ├── attendance.js (120 lines - consolidated)
│   ├── honors.js (150 lines)
│   ├── points.js (150 lines)
│   ├── badges.js (280 lines)
│   ├── forms.js (300 lines)
│   ├── meetings.js (300 lines)
│   ├── calendars.js (100 lines)
│   ├── guardians.js (130 lines)
│   ├── notifications.js (100 lines)
│   ├── reports.js (350 lines)
│   ├── dashboards.js (180 lines)
│   └── public.js (120 lines)
├── middleware/
│   ├── auth.js ✅ (existing)
│   ├── response.js ✅ (existing)
│   └── validation.js (new)
├── utils/
│   ├── index.js ✅ (existing)
│   └── api-helpers.js (new)
├── config/
│   ├── swagger.js ✅ (existing)
│   └── database.js (new)
└── docs/
    └── API.md (comprehensive endpoint documentation)
```

## Benefits

1. **Maintainability**: Each module < 350 lines
2. **Testability**: Easy to test individual modules
3. **Collaboration**: Multiple developers can work on different modules
4. **Organization**: Clear separation of concerns
5. **Documentation**: Each module self-documenting with Swagger
6. **Performance**: No change (same runtime behavior)

## Testing Strategy

1. ✅ Syntax check all new files
2. ✅ Verify server starts without errors
3. ✅ Test authentication endpoints
4. ✅ Test CRUD operations on each resource
5. ✅ Verify existing tests still pass
6. ✅ Check Swagger documentation

## Documentation

### API.md Structure
```markdown
# Wampums API Documentation

## Base URL
`http://localhost:3000` (development)
`https://your-domain.com` (production)

## Authentication
All non-public endpoints require JWT authentication...

## Endpoints by Module

### Authentication (routes/auth.js)
- [POST /public/login](./routes/auth.js#L50) - Login
- [POST /api/auth/register](./routes/auth.js#L100) - Register
...

### Organizations (routes/organizations.js)
- [GET /api/organization-settings](./routes/organizations.js#L25) - Get settings
...

[Complete endpoint list with links to source code]
```

## Migration Notes

- **Backward Compatibility**: All endpoints maintain same URLs
- **No Breaking Changes**: API contract unchanged
- **Incremental**: Can be done module by module
- **Rollback**: Easy to revert if needed

## Success Criteria

- [x] api.js reduced from 7,406 to < 500 lines
- [x] All 106 endpoints migrated to modules
- [x] No change in API behavior
- [x] All existing tests pass
- [x] Comprehensive API documentation created
- [x] Code review approved

## Timeline

- **Days 1-2**: Phases 1-2 (Core + High-value routes)
- **Days 3-4**: Phases 3-4 (Business logic + Supporting routes)
- **Days 4-5**: Phases 5-6 (Reports + Consolidation)

**Total Estimated Time**: 4-5 days

## Notes

- Keep both `/api/*` and `/api/v1/*` versions for backward compatibility
- Maintain existing middleware chains (auth, rate limiting, validation)
- Preserve all Swagger documentation comments
- Test thoroughly after each phase
