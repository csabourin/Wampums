# Wampums Scout Management System - Complete Architecture Documentation

**Last Updated:** 2025-12-01
**Branch:** `claude/update-architecture-docs-01CLgTWSHKjsa3E36MzfaEuK`
**Migration Status:** PHP → Node.js/Express (Core Features Complete, Forms/Badges/Reports In Progress)
**Frontend:** Single Page Application (SPA) with Vanilla JavaScript ES6 Modules
**Recent Updates:** Configurable Point System, Group Point Distribution, Cache Optimization

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [Configurable Point System](#configurable-point-system)
4. [API Endpoints Mapping](#api-endpoints-mapping)
5. [Frontend Pages & Interactions](#frontend-pages--interactions)
6. [Original PHP Implementation](#original-php-implementation)
7. [Migration Comparison: PHP vs Node.js](#migration-comparison-php-vs-nodejs)
8. [Database Schema](#database-schema)
9. [Authentication & Authorization](#authentication--authorization)
10. [Known Issues & Missing Features](#known-issues--missing-features)
11. [Recommendations & Roadmap](#recommendations--roadmap)

---

## Executive Summary

**Wampums** is a comprehensive Scout group management system that has been successfully migrated from a monolithic PHP application to a modern Node.js/Express backend with a Progressive Web App (PWA) frontend.

### Key Facts:
- **Original Implementation:** PHP (3,554 lines in api.php + supporting files)
- **Current Implementation:** Node.js/Express (2,900 lines in api.js + modular routes)
- **Frontend:** Vanilla JavaScript SPA (~12,700 lines across 47 modules)
- **Database:** PostgreSQL with 20+ tables
- **Authentication:** JWT-based with bcrypt password hashing
- **Multi-tenancy:** Organization-based isolation
- **Roles:** Admin, Animation (Staff), Parent

### Recent Enhancements (December 2025):
- ✅ **Configurable Point System**: Organizations can customize point values for attendance, honors, and badges
- ✅ **Group Point Distribution**: Group points automatically distributed to individual members with dual tracking
- ✅ **Cache Optimization**: Intelligent cache invalidation ensures point data persists across navigation
- ✅ **Improved Point UI**: Real-time updates with immediate visual feedback and server validation

### Purpose:
The system manages:
- **Scout participants** (member registration, profiles, health records)
- **Groups/Patrols** (Castors, Louveteaux, Éclaireurs, etc.)
- **Attendance tracking** with automatic configurable points
- **Points/Honors system** (individual & group with customizable rules)
- **Badge progress** (achievement tracking)
- **Meeting preparation** (activity planning)
- **Parent portal** (view children's progress)
- **Forms** (dynamic JSONB-based forms for registration, health, risk acceptance)
- **Reporting** (health reports, attendance, mailing lists)

---

## System Architecture Overview

### Technology Stack

#### Backend
```
Node.js v14+
├── Express.js (Web framework)
├── PostgreSQL (Database via 'pg' connection pool)
├── JWT (jsonwebtoken + bcrypt authentication)
├── Winston (Logging)
├── Helmet (Security headers)
├── CORS (Cross-origin support)
├── Swagger/OpenAPI (API documentation at /api-docs)
└── Web-Push (Push notifications)
```

#### Frontend
```
Vanilla JavaScript ES6
├── Vite (Build tool & dev server)
├── Service Worker (PWA offline support)
├── IndexedDB (Client-side caching)
├── Code Splitting (8 lazy-loaded chunks)
├── i18n (French & English)
└── Custom SPA Router (40+ routes)
```

### Directory Structure

```
/home/user/Wampums/
├── api.js                          # Main Node.js Express server (2,900 lines)
├── routes/                         # RESTful API route modules
│   ├── participants.js            # Participant CRUD (305 lines)
│   ├── groups.js                  # Group management (207 lines)
│   └── attendance.js              # Attendance tracking (166 lines)
├── middleware/
│   ├── auth.js                    # JWT verification & authorization
│   └── response.js                # Standardized API responses
├── config/
│   └── swagger.js                 # OpenAPI documentation
├── spa/                           # Frontend modules (47 files, ~12.7k lines)
│   ├── app.js                     # Application initialization
│   ├── router.js                  # SPA routing system
│   ├── ajax-functions.js          # API client
│   ├── indexedDB.js               # Offline storage
│   ├── jwt-helper.js              # Token management
│   ├── dashboard.js               # Main dashboard
│   ├── login.js                   # Authentication
│   ├── attendance.js              # Attendance tracking UI
│   ├── manage_points.js           # Points management UI
│   ├── manage_honors.js           # Honors/badges UI
│   ├── manage_participants.js     # Participant management
│   ├── manage_groups.js           # Group management
│   ├── parent_dashboard.js        # Parent view
│   ├── preparation_reunions.js    # Meeting preparation
│   ├── reports.js                 # Reports & analytics
│   └── [35+ more modules]
├── css/
│   ├── styles.css                 # Main stylesheet (28,665 lines)
│   └── manage_names.css           # Name management styles
├── lang/                          # Translations (en/fr)
├── images/                        # Static assets
├── index.html                     # SPA entry point
├── service-worker.js              # PWA service worker
├── manifest.json                  # PWA manifest
├── vite.config.js                 # Build configuration
├── package.json                   # Dependencies
├── .env.example                   # Environment variables template
└── LEGACY FILES (deprecated):
    ├── api.php                    # Original PHP API (3,554 lines)
    ├── config.php                 # PHP database config
    ├── functions.php              # PHP helper functions (11,080 lines)
    ├── jwt_auth.php               # PHP JWT authentication
    └── index.php                  # Original PHP entry point
```

---

## Configurable Point System

**Status:** ✅ Fully Implemented (December 2025)
**Commits:** 397eea1, 4c8a180, ddf75fc, 3180999, 951cb54

The Wampums system now features a fully configurable point system that allows organizations to customize point values for different activities while maintaining both individual and group-level tracking.

### Core Features

1. **Organization-Level Configuration**
   - Point values stored in `organization_settings` table with key `'point_system_rules'`
   - Configurable via JSON structure
   - Falls back to sensible defaults if not configured

2. **Configurable Point Values**
   - **Attendance Points**: Customizable for each status (present, absent, late, excused)
   - **Honor Awards**: Configurable points for receiving honors
   - **Badges**: Separate values for earning badges and leveling up

3. **Group Point Distribution**
   - Group points automatically distributed to all members
   - Dual tracking: maintains both group-level total and individual totals
   - Individual member contributions visible in UI

4. **Intelligent Caching**
   - Point-related caches automatically invalidated on updates
   - 5-minute cache duration for point data (down from 24 hours)
   - Multi-cache clearing: participants, dashboard_groups, manage_points_data

### Point System Configuration Structure

```javascript
{
  "attendance": {
    "present": { "label": "present", "points": 1 },
    "absent": { "label": "absent", "points": 0 },
    "late": { "label": "late", "points": 0 },
    "excused": { "label": "excused", "points": 0 }
  },
  "honors": {
    "award": 5
  },
  "badges": {
    "earn": 5,
    "level_up": 10
  }
}
```

### Implementation Details

#### Backend Functions (api.js)

**`getPointSystemRules(organizationId, client)` (Lines 120-152)**
- Fetches point rules from `organization_settings` table
- Parses JSON configuration with error handling
- Returns default rules if none configured or on parse error

**`calculateAttendancePoints(previousStatus, newStatus, pointRules)` (Lines 155-168)**
- Calculates point differential when attendance status changes
- Uses configured point values from rules
- Returns 0 if no change in points value
- Example: Changing from null → "present" awards +1 point (configurable)

#### Updated Endpoints

**`POST /api/award-honor` (Lines 1007-1068)**
```javascript
// Fetches point system rules
const pointRules = await getPointSystemRules(organizationId, client);
const honorPoints = pointRules.honors?.award || 5;

// Awards honor with configurable points
// Includes group_id for proper attribution
```

**`POST /api/update-attendance` (Lines 1145-1212)**
```javascript
// Calculates point adjustment based on status change
const pointAdjustment = calculateAttendancePoints(
  previous_status,
  status,
  pointRules
);

// Only creates point record if adjustment !== 0
// Returns pointUpdates array with details
```

**`POST /api/update-points` (Lines 1247-1302)**
```javascript
// For group points:
// 1. Insert group-level point record (participant_id = NULL)
// 2. Distribute to all members (one record per member)
// 3. Calculate group total and individual totals
// 4. Return memberTotals array for UI update

// Response includes:
{
  type: 'group',
  id: groupId,
  totalPoints: groupTotal,
  memberIds: [...],
  memberTotals: [{id, totalPoints}, ...]
}
```

#### Frontend Implementation

**Cache Management (spa/indexedDB.js, Lines 192-209)**
```javascript
export async function clearPointsRelatedCaches() {
  const keysToDelete = [
    'participants',
    'manage_points_data',
    'dashboard_groups',
    'dashboard_participant_info'
  ];

  for (const key of keysToDelete) {
    await deleteCachedData(key);
  }
}
```

**Point UI Updates (spa/manage_points.js)**
- Lines 430-466: `updateGroupPoints()` - Updates both group total and member totals
- Lines 491-545: `updatePointsUI()` - Provides optimistic UI updates
- Lines 410-411: Calls `clearPointsRelatedCaches()` after successful update

### Database Schema

**Points Table with Group Attribution**
```sql
CREATE TABLE points (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER,        -- NULL for group-level points
  group_id INTEGER,              -- Attribution to group
  value INTEGER NOT NULL,        -- Point value (positive/negative)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  organization_id INTEGER REFERENCES organizations(id)
);
```

**Key Design Decisions:**
- `participant_id = NULL`: Identifies group-level point records
- `group_id`: Links points to originating group
- `value`: Supports both additions (positive) and deductions (negative)
- **Dual Tracking**:
  - Group total = `SUM(value) WHERE participant_id IS NULL AND group_id = X`
  - Member total = `SUM(value) WHERE participant_id = Y`

### Point Calculation Flow

```
1. User action triggers point change (attendance, honor, manual)
   ↓
2. getPointSystemRules() fetches organization configuration
   ↓
3. Calculate point adjustment based on rules
   ↓
4. Get participant's group_id (if applicable)
   ↓
5. BEGIN database transaction
   ↓
6. INSERT point record(s)
   - For individuals: one record with participant_id
   - For groups: one record + one per member
   ↓
7. Calculate new totals
   ↓
8. COMMIT transaction
   ↓
9. Return updated totals to frontend
   ↓
10. Clear point-related caches
    ↓
11. Update UI with server-validated values
```

### Transaction Safety

All point operations use database transactions:
```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Point operations here

  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

This ensures:
- Atomic operations (all-or-nothing)
- Consistency across related tables
- Automatic rollback on errors
- No partial updates in case of failures

### Cache Strategy

**Problem Solved:** Points not persisting across page navigation

**Solution:**
1. Reduced cache duration from 24 hours → 5 minutes for point data
2. Invalidate all related caches after point updates
3. Clear multiple cache keys:
   - `participants`: Participant list with totals
   - `manage_points_data`: Point management page data
   - `dashboard_groups`: Group summaries on dashboard
   - `dashboard_participant_info`: Participant info on dashboard

**Cache Flow:**
```
Point update occurs
    ↓
API returns new totals
    ↓
UI updates immediately (optimistic)
    ↓
clearPointsRelatedCaches() invalidates old data
    ↓
Next data fetch gets fresh values from server
    ↓
updateCache() stores new data with 5-min TTL
```

### Configuration via Database

Organizations can customize point values by inserting/updating in `organization_settings`:

```sql
INSERT INTO organization_settings (organization_id, setting_key, setting_value)
VALUES (
  1,
  'point_system_rules',
  '{
    "attendance": {
      "present": {"label": "present", "points": 2},
      "late": {"label": "late", "points": 1}
    },
    "honors": {"award": 10},
    "badges": {"earn": 10, "level_up": 20}
  }'::jsonb
)
ON CONFLICT (organization_id, setting_key)
DO UPDATE SET setting_value = EXCLUDED.setting_value;
```

### Benefits of This Implementation

1. **Flexibility**: Each organization can tailor point values to their program
2. **Consistency**: Single source of truth for point calculations
3. **Transparency**: Group contributions visible to individuals
4. **Performance**: Intelligent caching prevents stale data
5. **Reliability**: Transactions ensure data integrity
6. **Auditability**: All point changes logged with timestamps

### Future Enhancements

Potential improvements identified:
- [ ] UI for admins to configure point rules (currently database-only)
- [ ] Point history/audit log viewer
- [ ] Automated point decay or reset schedules
- [ ] Point categories/tags for different activities
- [ ] Export point reports for specific date ranges

---

## API Endpoints Mapping

### RESTful API v1 Routes (New Implementation)

#### Participants API
**Module:** `/routes/participants.js`

| Method | Endpoint | Auth | Roles | Purpose | Request | Response |
|--------|----------|------|-------|---------|---------|----------|
| GET | `/api/v1/participants` | ✓ | All | List all participants with pagination & filtering | `?page=1&limit=50&group_id=3` | Paginated list with group info |
| GET | `/api/v1/participants/:id` | ✓ | All | Get single participant details | - | Full participant object with group |
| POST | `/api/v1/participants` | ✓ | Admin, Animation | Create new participant | `{first_name, last_name, date_of_birth, group_id}` | Created participant |
| PUT | `/api/v1/participants/:id` | ✓ | Admin, Animation | Update participant | `{first_name, last_name, date_of_birth, group_id}` | Updated participant |
| DELETE | `/api/v1/participants/:id` | ✓ | Admin | Remove participant from org | - | Success message |

**Implementation Details:**
- Uses database transactions for multi-table updates
- Automatically links participants to organizations via `participant_organizations` table
- Group assignment updates `participant_groups` table
- Soft delete (removes from organization but keeps participant record)

#### Groups API
**Module:** `/routes/groups.js`

| Method | Endpoint | Auth | Roles | Purpose | Request | Response |
|--------|----------|------|-------|---------|---------|----------|
| GET | `/api/v1/groups` | ✓ | All | List all groups with member count & total points | - | Array of groups with stats |
| GET | `/api/v1/groups/:id` | ✓ | All | Get group details with members | - | Group object with member list |
| POST | `/api/v1/groups` | ✓ | Admin, Animation | Create new group | `{name}` | Created group |
| PUT | `/api/v1/groups/:id` | ✓ | Admin, Animation | Update group | `{name}` | Updated group |
| DELETE | `/api/v1/groups/:id` | ✓ | Admin | Delete group | - | Success message |

**Implementation Details:**
- Aggregates points across all group members
- Returns member count via JOIN with `participant_groups`
- Includes leader/second leader designation

#### Attendance API
**Module:** `/routes/attendance.js`

| Method | Endpoint | Auth | Roles | Purpose | Request | Response |
|--------|----------|------|-------|---------|---------|----------|
| GET | `/api/v1/attendance` | ✓ | All | Get attendance records | `?date=2025-12-01&participant_id=5` | Attendance records with participant info |
| GET | `/api/v1/attendance/dates` | ✓ | All | Get all attendance dates | - | Array of dates |
| POST | `/api/v1/attendance` | ✓ | Admin, Animation | Mark attendance | `{participant_id, date, status, previous_status}` | Created/updated record |

**Implementation Details:**
- Supports filtering by date and participant
- Upsert operation (INSERT ... ON CONFLICT DO UPDATE)
- Automatic point calculation based on status change:
  - Present: +1 point
  - Late: +0.5 points
  - Absent: 0 points
  - Excused: 0 points
- Uses transactions to ensure point consistency

### Legacy-Compatible Endpoints (Migrated from PHP)

#### Public Endpoints (No Auth Required)

| Method | Endpoint | Purpose | Original PHP | Status |
|--------|----------|---------|--------------|--------|
| GET | `/` | Serve main SPA | `index.php` | ✓ Migrated |
| GET | `/api/translations` | Get i18n translations | `get_translations.php` | ✓ Migrated |
| GET | `/api/news` | Get organization news | `get-news.php` | ✓ Migrated |
| GET | `/api/organization-jwt` | Generate org-only JWT | `get-organization-jwt.php` | ✓ Migrated |
| POST | `/public/login` | User authentication | `api.php?action=login` | ✓ Migrated |
| GET | `/public/get_organization_id` | Get current org ID | `api.php?action=get_organization_id` | ✓ Migrated |

#### Authenticated Endpoints

| Method | Endpoint | Purpose | Original PHP Action | Auth | Status |
|--------|----------|---------|---------------------|------|--------|
| GET | `/api/organization-settings` | Get org settings | `get_organization_settings` | ✓ | ✓ Migrated |
| GET | `/api/reunion-preparation` | Get meeting prep data | `get_reunion_preparation` | ✓ | ✓ Migrated |
| GET | `/api/points-data` | Get all points data | `get_points_data` (via file) | ✓ | ✓ Migrated |
| GET | `/api/initial-data` | Bootstrap app data | `initial-data.php` | Optional | ✓ Migrated |
| POST | `/api/push-subscription` | Save push notification sub | `save-subscription.php` | ✓ | ✓ Migrated |
| POST | `/api/send-notification` | Send push notification | `send-notification.php` | ✓ Admin | ✓ Migrated |

#### Dashboard & Management Endpoints

| Method | Endpoint | Purpose | Original PHP Action | Auth | Status |
|--------|----------|---------|---------------------|------|--------|
| GET | `/api/participants` | List participants | `get_participants` | ✓ | ✓ Migrated |
| GET | `/api/get_groups` | List groups | `get_groups` | ✓ | ✓ Migrated |
| GET | `/api/honors` | Get honors data | `get_honors` | ✓ | ✓ Migrated |
| POST | `/api/award-honor` | Award honor to participant(s) | `award_honor` | ✓ | ✓ Migrated |
| GET | `/api/attendance` | Get attendance data | `get_attendance` | ✓ | ✓ Migrated |
| POST | `/api/update-attendance` | Update attendance status | `update_attendance` | ✓ | ✓ Migrated |
| POST | `/api/update-points` | Update points | `update_points` | ✓ | ✓ Migrated |
| GET | `/api/guests-by-date` | Get guest list by date | `get_guests_by_date` | ✓ | ✓ Migrated |
| POST | `/api/save-guest` | Save guest info | `save_guest` | ✓ | ✓ Migrated |
| GET | `/api/get_reminder` | Get meeting reminder | `get_reminder` | ✓ | ✓ Migrated |
| POST | `/api/save_reminder` | Save meeting reminder | `save_reminder` | ✓ | ✓ Migrated |
| GET | `/api/reunion-dates` | Get all meeting dates | `get_reunion_dates` | ✓ | ✓ Migrated |
| GET | `/api/attendance-dates` | Get attendance dates | `get_attendance_dates` | ✓ | ✓ Migrated |
| GET | `/api/participant-details` | Get participant details | `get_participant` | ✓ | ✓ Migrated |
| GET | `/api/mailing-list` | Get mailing list | `get_mailing_list` | ✓ | ✓ Migrated |
| GET | `/api/calendars` | Get payment calendars | `get_calendars` | ✓ | ✓ Migrated |
| GET | `/api/next-meeting-info` | Get next meeting info | `get_next_meeting_info` | ✓ | ✓ Migrated |
| GET | `/api/animateurs` | Get staff list | `get_animateurs` | ✓ | ✓ Migrated |
| GET | `/api/parent-contact-list` | Get parent contacts | `get_parent_contact_list` | ✓ | ✓ Migrated |
| GET | `/api/users` | Get user list | `get_users` | ✓ | ✓ Migrated |
| GET | `/api/participants-with-users` | Get participants with linked users | `get_participants_with_users` | ✓ | ✓ Migrated |
| GET | `/api/parent-users` | Get parent users | `get_parent_users` | ✓ | ✓ Migrated |

### Action-Based API (Legacy PHP - Deprecated)

The original PHP implementation used a single endpoint with action parameters:

**Pattern:** `GET/POST /api.php?action=<action_name>`

#### All PHP Actions (88 total)

**Authentication & User Management (9 actions):**
1. `login` - User login → ✓ Migrated to `POST /public/login`
2. `register` - User registration → ⚠️ **Partially migrated**
3. `logout` - User logout → ⚠️ **Frontend only**
4. `request_reset` - Password reset request → ⚠️ **Missing**
5. `reset_password` - Reset password → ⚠️ **Missing**
6. `verify_session` - Check session validity → ⚠️ **Replaced by JWT**
7. `approve_user` - Admin approve new user → ⚠️ **Missing**
8. `get_users` - List all users → ✓ Migrated to `GET /api/users`
9. `link_user_participants` - Link user to participants → ⚠️ **Missing**

**Organization Management (8 actions):**
10. `get_organization_id` - Get org ID → ✓ Migrated to `GET /public/get_organization_id`
11. `get_organization_settings` - Get org settings → ✓ Migrated to `GET /api/organization-settings`
12. `switch_organization` - Switch active org → ⚠️ **Missing**
13. `create_organization` - Create new org → ⚠️ **Missing**
14. `register_for_organization` - Register user for org → ⚠️ **Missing**
15. `get_user_children` - Get user's children → ⚠️ **Missing**
16. `get_organization_form_formats` - Get custom form formats → ⚠️ **Missing**
17. `get_subscribers` - Get push notification subscribers → ⚠️ **Missing**

**Participant Management (10 actions):**
18. `get_participants` - List participants → ✓ Migrated to `GET /api/participants` + `/api/v1/participants`
19. `get_participant` - Get single participant → ✓ Migrated to `GET /api/v1/participants/:id`
20. `save_participant` - Create/update participant → ✓ Migrated to `POST/PUT /api/v1/participants`
21. `remove_participant_from_organization` - Remove from org → ✓ Migrated to `DELETE /api/v1/participants/:id`
22. `participant-age` - Get participants with ages → ⚠️ **Missing**
23. `get_participants_with_documents` - Participants with docs → ⚠️ **Missing**
24. `get_participants_with_users` - Participants with user links → ✓ Migrated to `GET /api/participants-with-users`
25. `link_participant_to_organization` - Link participant to org → ⚠️ **Missing**
26. `associate_user` - Associate user with participant → ⚠️ **Missing**
27. `link_parent_to_participant` - Link parent to child → ⚠️ **Missing**

**Group Management (7 actions):**
28. `get_groups` - List groups → ✓ Migrated to `GET /api/get_groups` + `/api/v1/groups`
29. `add_group` - Create group → ✓ Migrated to `POST /api/v1/groups`
30. `update_group_name` - Update group → ✓ Migrated to `PUT /api/v1/groups/:id`
31. `remove_group` - Delete group → ✓ Migrated to `DELETE /api/v1/groups/:id`
32. `update_participant_group` - Assign participant to group → ⚠️ **Via participant update**
33. `remove_participant_from_group` - Remove from group → ⚠️ **Missing**
34. `check_permission` - Check user permission → ⚠️ **Replaced by middleware**

**Attendance Management (7 actions):**
35. `get_attendance` - Get attendance records → ✓ Migrated to `GET /api/attendance` + `/api/v1/attendance`
36. `get_attendance_dates` - Get attendance dates → ✓ Migrated to `GET /api/v1/attendance/dates`
37. `getAvailableDates` - Get available dates → ✓ Migrated to `GET /api/v1/attendance/dates`
38. `update_attendance` - Mark attendance → ✓ Migrated to `POST /api/update-attendance` + `/api/v1/attendance`
39. `get_guests_by_date` - Get guests → ✓ Migrated to `GET /api/guests-by-date`
40. `save_guest` - Save guest → ✓ Migrated to `POST /api/save-guest`
41. `get_reunion_dates` - Get meeting dates → ⚠️ **Missing**

**Points & Honors Management (6 actions):**
42. `update_points` - Add/update points → ✓ Migrated to `POST /api/update-points`
43. `get_honors` - Get honors list → ✓ Migrated to `GET /api/honors`
44. `award_honor` - Award honor → ✓ Migrated to `POST /api/award-honor`
45. `get_recent_honors` - Get recent honors → ⚠️ **Missing**
46. `get_current_stars` - Get star badges → ⚠️ **Missing**
47. `get_points_report` - Points report → ⚠️ **Missing**

**Badge Management (5 actions):**
48. `get_badge_progress` - Get badge progress → ⚠️ **Missing**
49. `save_badge_progress` - Save badge progress → ⚠️ **Missing**
50. `get_pending_badges` - Get pending approvals → ⚠️ **Missing**
51. `update_badge_status` - Approve/reject badge → ⚠️ **Missing**
52. `get_honors_report` - Honors report → ⚠️ **Missing**

**Forms & Submissions (9 actions):**
53. `get_form_types` - Get available form types → ⚠️ **Missing**
54. `get_form_structure` - Get form structure → ⚠️ **Missing**
55. `get_form_submissions` - Get submissions → ⚠️ **Missing**
56. `get_form_submission` - Get single submission → ⚠️ **Missing**
57. `save_form_submission` - Save form → ⚠️ **Missing**
58. `save_guardian_form_submission` - Save guardian form → ⚠️ **Missing**
59. `save_fiche_sante` - Save health form → ⚠️ **Missing**
60. `get_acceptation_risque` - Get risk acceptance → ⚠️ **Missing**
61. `save_acceptation_risque` - Save risk acceptance → ⚠️ **Missing**

**Guardian/Parent Management (5 actions):**
62. `get_guardians` - Get participant guardians → ⚠️ **Missing**
63. `get_guardian_info` - Get guardian info → ⚠️ **Missing**
64. `save_parent` - Save parent info → ⚠️ **Missing**
65. `remove_guardians` - Remove guardians → ⚠️ **Missing**
66. `get_parent_dashboard_data` - Parent dashboard data → ⚠️ **Missing**

**Meeting/Reunion Management (6 actions):**
67. `get_reunion_preparation` - Get meeting prep → ✓ Migrated to `GET /api/reunion-preparation`
68. `save_reunion_preparation` - Save meeting prep → ⚠️ **Missing**
69. `get_reunion_dates` - Get meeting dates → ✓ Migrated to `GET /api/reunion-dates`
70. `get_reminder` - Get reminder → ⚠️ **Missing**
71. `save_reminder` - Save reminder → ⚠️ **Missing**
72. `get_activites_rencontre` - Get activity templates → ⚠️ **Missing**

**Reports & Analytics (11 actions):**
73. `get_mailing_list` - Email distribution list → ✓ Migrated to `GET /api/mailing-list`
74. `get_health_report` - Health info report → ⚠️ **Missing**
75. `get_health_contact_report` - Health contacts report → ⚠️ **Missing**
76. `get_attendance_report` - Attendance report → ⚠️ **Missing**
77. `get_allergies_report` - Allergies report → ⚠️ **Missing**
78. `get_medication_report` - Medication report → ⚠️ **Missing**
79. `get_vaccine_report` - Vaccine report → ⚠️ **Missing**
80. `get_leave_alone_report` - Permission report → ⚠️ **Missing**
81. `get_media_authorization_report` - Media consent report → ⚠️ **Missing**
82. `get_missing_documents_report` - Missing docs report → ⚠️ **Missing**
83. `get_parent_contact_list` - Parent contacts → ✓ Migrated to `GET /api/parent-contact-list`
84. `participant-age` - Age-based report → ⚠️ **Missing**

**Calendar/Payment Management (4 actions):**
85. `get_calendars` - Get payment calendars → ✓ Migrated to `GET /api/calendars`
86. `get_participant_calendar` - Get participant calendar → ⚠️ **Missing**
87. `update_calendar` - Update calendar entry → ⚠️ **Missing**
88. `update_calendar_paid` - Mark payment received → ⚠️ **Missing**
89. `update_calendar_amount_paid` - Update payment amount → ⚠️ **Missing**

**Other:**
90. `get_animateurs` - Get staff list → ✓ Migrated to `GET /api/animateurs`
91. `update_user_role` - Update user role → ⚠️ **Missing**

### Migration Status Summary

| Category | Total Actions | Migrated | Missing | Percentage |
|----------|--------------|----------|---------|------------|
| Authentication | 9 | 2 | 7 | 22% |
| Organization | 8 | 2 | 6 | 25% |
| Participants | 10 | 6 | 4 | 60% |
| Groups | 7 | 5 | 2 | 71% |
| Attendance | 7 | 6 | 1 | 86% |
| Points/Honors | 6 | 3 | 3 | 50% |
| Badges | 5 | 0 | 5 | 0% |
| Forms | 9 | 0 | 9 | 0% |
| Guardians | 5 | 0 | 5 | 0% |
| Meetings | 6 | 2 | 4 | 33% |
| Reports | 11 | 2 | 9 | 18% |
| Calendar | 5 | 1 | 4 | 20% |
| **TOTAL** | **91** | **29** | **62** | **32%** |

---

## Frontend Pages & Interactions

### SPA Router Configuration

**Router Module:** `/spa/router.js`
**Total Routes:** 40+ defined routes with lazy loading

### Route Mapping

| Route | Module | Component | Auth | Roles | Purpose | User Interactions |
|-------|--------|-----------|------|-------|---------|-------------------|
| `/` | dashboard.js | Dashboard | ✓ | All | Main dashboard | Role-based dashboard (admin/staff: full dashboard, parent: child dashboard) |
| `/index.php` | dashboard.js | Dashboard | ✓ | All | Legacy route redirect | Redirects to dashboard |
| `/login` | login.js | Login | ✗ | Public | User login | Email/password form, JWT stored in localStorage, redirects to role-appropriate dashboard |
| `/logout` | - | Logout | ✓ | All | Clear session | Clears localStorage (jwtToken), redirects to /login |
| `/register` | register.js | Register | ✗ | Public | New user registration | Email, password, full name, role selection |
| `/reset-password` | reset_password.js | ResetPassword | ✗ | Public | Password recovery | Email input, token validation, new password |
| `/admin` | admin.js | Admin | ✓ | Admin | Admin panel | User approval, organization settings, system config |
| `/dashboard` | dashboard.js | Dashboard | ✓ | All | Dashboard redirect | Same as `/` |
| `/parent-dashboard` | parent_dashboard.js | ParentDashboard | ✓ | Parent | Parent portal | View children's attendance, points, badges, documents |
| `/formulaire-inscription` | formulaire_inscription.js | FormulaireInscription | ✓ | Admin, Animation | New member registration | Multi-step form: participant info, guardians, health info, emergency contacts |
| `/formulaire-inscription/:id` | formulaire_inscription.js | FormulaireInscription | ✓ | Admin, Animation | Edit registration | Edit existing participant registration |
| `/attendance` | attendance.js | Attendance | ✓ | Admin, Animation | Attendance tracking | Select date, mark present/absent/late/excused, auto-save, guest tracking |
| `/managePoints` | manage_points.js | ManagePoints | ✓ | Admin, Animation | Points management | Add/subtract points for individuals or groups, real-time updates |
| `/manageHonors` | manage_honors.js | ManageHonors | ✓ | Admin, Animation | Honor awards | Select date, award "Louveteau d'Honneur", automatic +5 points |
| `/manage-participants` | manage_participants.js | ManageParticipants | ✓ | Admin, Animation | Participant CRUD | Add/edit/delete participants, assign to groups, view details |
| `/manage-groups` | manage_groups.js | ManageGroups | ✓ | Admin, Animation | Group management | Create/edit/delete groups, view members, assign leaders |
| `/manage-users-participants` | manage_users_participants.js | ManageUsersParticipants | ✓ | Admin | User-participant linking | Link users to participants for parent access |
| `/view-participant-documents` | view_participant_documents.js | ViewParticipantDocuments | ✓ | Admin, Animation | Document viewer | View submitted forms (health, registration, risk acceptance) |
| `/approve-badges` | approve_badges.js | ApproveBadges | ✓ | Admin, Animation | Badge approval | Approve/reject badge submissions from participants |
| `/parent-contact-list` | parent_contact_list.js | ParentContactList | ✓ | Admin, Animation | Parent contacts | View parent/guardian contact info, emails, phones |
| `/mailing-list` | mailing_list.js | MailingList | ✓ | Admin, Animation | Email lists | Generate email lists by role, export contacts |
| `/fiche-sante/:id` | fiche_sante.js | FicheSante | ✓ | Admin, Animation, Parent | Health form | Medical info, allergies, medications, emergency contacts |
| `/acceptation-risque/:id` | acceptation_risque.js | AcceptationRisque | ✓ | Admin, Animation, Parent | Risk acceptance | Activity risk acknowledgment, permissions |
| `/badge-form/:id` | badge_form.js | BadgeForm | ✓ | Parent, Animation | Badge application | Submit badge progress for approval |
| `/calendars` | calendars.js | Calendars | ✓ | Admin, Animation | Payment tracking | Track payments, dues, event fees |
| `/reports` | reports.js | Reports | ✓ | Admin, Animation | Reports dashboard | Health reports, attendance stats, missing docs |
| `/preparation-reunions` | preparation_reunions.js | PreparationReunions | ✓ | Admin, Animation | Meeting planning | Plan activities, assign roles, prepare materials |
| `/register-organization` | register_organization.js | RegisterOrganization | ✗ | Public | Organization registration | Register new scout organization |
| `/create-organization` | create_organization.js | CreateOrganization | ✓ | Admin | Create organization | Admin creates new organization |
| `/dynamic-form/:type/:id` | dynamicFormHandler.js | DynamicFormHandler | ✓ | Varies | Dynamic forms | Render JSONB-based custom forms |
| `/group-participant-report` | group-participant-report.js | PrintableGroupParticipantReport | ✓ | Admin, Animation | Printable report | Print-friendly group roster |
| `/upcoming-meeting` | upcoming_meeting.js | UpcomingMeeting | ✓ | All | Next meeting info | Display next meeting details, activities |

### Page-Specific Interactions

#### `/login` (Login Page)
**Module:** `spa/login.js`

**Interactions:**
1. **Email Input** - User enters email (case-insensitive)
2. **Password Input** - User enters password
3. **Submit Login** - `POST /public/login`
   - **Success:** JWT stored in localStorage, redirect to dashboard
   - **Failure:** Display error message
4. **Register Link** - Navigate to `/register`
5. **Forgot Password** - Navigate to `/reset-password`

**Original PHP:** `api.php?action=login`
**Migration Status:** ✓ Complete
**Known Issues:** None

---

#### `/dashboard` (Main Dashboard)
**Module:** `spa/dashboard.js`

**Interactions (Admin/Animation):**
1. **View Participant Count** - Display total participants
2. **View Group Summary** - List all groups with member counts
3. **Quick Actions Menu:**
   - Take Attendance → `/attendance`
   - Manage Points → `/managePoints`
   - Award Honors → `/manageHonors`
   - View Reports → `/reports`
4. **Recent Activity Feed** - Display recent honors, attendance
5. **Upcoming Meeting Widget** - Show next meeting details
6. **News Accordion** - Collapsible organization news

**Interactions (Parent):**
- Automatically redirects to `/parent-dashboard`

**API Calls:**
- `GET /api/participants` - Load all participants
- `GET /api/get_groups` - Load all groups
- `GET /api/news` - Load news items
- `GET /api/next-meeting-info` - Get next meeting

**Original PHP:** `index.php`
**Migration Status:** ✓ Complete
**Known Issues:** None

---

#### `/attendance` (Attendance Tracking)
**Module:** `spa/attendance.js` (24,106 lines)

**Interactions:**
1. **Date Selection**
   - Dropdown of available dates
   - Date picker for new date
   - `GET /api/attendance?date=YYYY-MM-DD`
2. **Group Filter** - Filter participants by group
3. **Mark Attendance** - For each participant:
   - **Present** - Green button, +1 point
   - **Absent** - Red button, 0 points
   - **Late** - Yellow button, +0.5 points
   - **Excused** - Blue button, 0 points
   - Auto-saves to `POST /api/update-attendance`
4. **Bulk Actions**
   - "Mark All Present" - Set all to present
   - "Clear All" - Remove all attendance
5. **Guest Tracking**
   - Add guest name/email
   - `POST /api/save-guest`
   - View guests: `GET /api/guests-by-date`
6. **Points Preview** - Real-time point calculation display
7. **Export** - Download attendance as CSV

**API Calls:**
- `GET /api/attendance?date=YYYY-MM-DD` - Get attendance for date
- `GET /api/attendance-dates` - Get all dates with attendance
- `POST /api/update-attendance` - Update attendance status
- `GET /api/guests-by-date?date=YYYY-MM-DD` - Get guests
- `POST /api/save-guest` - Add guest

**Original PHP:** `api.php?action=get_attendance`, `api.php?action=update_attendance`
**Migration Status:** ✓ Complete
**Known Issues:**
- Automatic point adjustment on status change works correctly
- Previous status tracking implemented in frontend

---

#### `/managePoints` (Points Management)
**Module:** `spa/manage_points.js` (25,987 lines)

**Interactions:**
1. **View Points Dashboard**
   - Group points totals
   - Individual participant points
   - Leaderboard view
   - `GET /api/points-data`
2. **Add Points (Individual)**
   - Select participant
   - Enter point value (+/-)
   - Optional note/reason
   - `POST /api/update-points`
3. **Add Points (Group)**
   - Select group
   - Enter point value
   - Points applied to all group members
   - `POST /api/update-points`
4. **Point History**
   - View point transactions by participant
   - Filter by date range
   - Show reason/context
5. **Reset Points** (Admin only)
   - Reset individual participant points
   - Reset group points
   - Confirmation dialog

**API Calls:**
- `GET /api/points-data` - Get all points data
- `POST /api/update-points` - Update points (array of updates)
  - Request: `[{type: 'participant', id: 5, points: 10}, {type: 'group', id: 2, points: 5}]`
  - Response: `{success: true, updates: [{type, id, totalPoints}]}`

**Original PHP:** `api.php?action=update_points`
**Migration Status:** ✓ Complete
**Known Issues:**
- ⚠️ Recent fix (PR #9) addressed error 500 when adding points to individuals
- Participant ID mapping corrected to match frontend expectations

---

#### `/manageHonors` (Honor Awards)
**Module:** `spa/manage_honors.js` (9,220 lines)

**Interactions:**
1. **Date Selection**
   - Select date for honors
   - Default to current date
   - `GET /api/honors?date=YYYY-MM-DD`
2. **View Participants by Group**
   - Grouped by patrol/section
   - Shows existing honors
3. **Award Honor**
   - Click participant card
   - Toggle honor status
   - Auto-saves to `POST /api/award-honor`
   - Automatic +5 points awarded
4. **Honor History**
   - View past honor dates
   - See who received honors
5. **Print View** - Printable honor certificates

**API Calls:**
- `GET /api/honors` - Get all honors and participants
- `POST /api/award-honor` - Award honor
  - Accepts single object: `{participantId: 5, date: '2025-12-01'}`
  - Accepts array: `[{participantId: 5, date: '2025-12-01'}, ...]`
  - Automatically awards 5 points

**Original PHP:** `api.php?action=get_honors`, `api.php?action=award_honor`
**Migration Status:** ✓ Complete
**Known Issues:** None

---

#### `/manage-participants` (Participant Management)
**Module:** `spa/manage_participants.js`

**Interactions:**
1. **View Participant List**
   - Searchable table
   - Filter by group
   - Sort by name, age, group
   - `GET /api/v1/participants`
2. **Add Participant**
   - Modal form
   - Fields: first_name, last_name, date_of_birth, group_id
   - `POST /api/v1/participants`
3. **Edit Participant**
   - Click participant row
   - Edit modal
   - `PUT /api/v1/participants/:id`
4. **Delete Participant**
   - Confirmation dialog
   - `DELETE /api/v1/participants/:id`
   - Soft delete (removes from organization)
5. **Assign to Group**
   - Drag-drop interface
   - Dropdown group selector
6. **View Details**
   - Navigate to `/view-participant-documents?id=:id`
   - Shows all forms, health info, guardians

**API Calls:**
- `GET /api/v1/participants` - List with pagination
- `GET /api/v1/participants/:id` - Get details
- `POST /api/v1/participants` - Create
- `PUT /api/v1/participants/:id` - Update
- `DELETE /api/v1/participants/:id` - Delete

**Original PHP:** `api.php?action=get_participants`, `api.php?action=save_participant`, `api.php?action=remove_participant_from_organization`
**Migration Status:** ✓ Complete (RESTful API)
**Known Issues:** None

---

#### `/manage-groups` (Group Management)
**Module:** `spa/manage_groups.js`

**Interactions:**
1. **View Groups**
   - List all groups
   - Show member count, total points
   - `GET /api/v1/groups`
2. **Create Group**
   - Enter group name (e.g., "Castors", "Louveteaux")
   - `POST /api/v1/groups`
3. **Edit Group**
   - Rename group
   - `PUT /api/v1/groups/:id`
4. **Delete Group**
   - Confirmation (checks for members)
   - `DELETE /api/v1/groups/:id`
5. **View Group Members**
   - Click group card
   - `GET /api/v1/groups/:id`
   - Shows leaders, members, points

**API Calls:**
- `GET /api/v1/groups` - List all groups
- `GET /api/v1/groups/:id` - Get group with members
- `POST /api/v1/groups` - Create group
- `PUT /api/v1/groups/:id` - Update group
- `DELETE /api/v1/groups/:id` - Delete group

**Original PHP:** `api.php?action=get_groups`, `api.php?action=add_group`, `api.php?action=update_group_name`, `api.php?action=remove_group`
**Migration Status:** ✓ Complete (RESTful API)
**Known Issues:** None

---

#### `/parent-dashboard` (Parent Portal)
**Module:** `spa/parent_dashboard.js` (18,996 lines)

**Interactions:**
1. **View Children**
   - List of linked participants
   - Click to view details
2. **Attendance History**
   - Calendar view of child's attendance
   - Monthly/yearly stats
3. **Points & Honors**
   - Current point total
   - Honor history
4. **Badge Progress**
   - View badge requirements
   - See completed badges
   - Submit badge applications → `/badge-form/:id`
5. **Forms & Documents**
   - View submitted forms
   - Update health form → `/fiche-sante/:id`
   - Update risk acceptance → `/acceptation-risque/:id`
6. **Upcoming Events**
   - Next meeting info
   - Calendar of events

**API Calls:**
- `GET /api/parent-dashboard-data` - ⚠️ **MISSING ENDPOINT**
- Uses participant endpoints to fetch data

**Original PHP:** `api.php?action=get_parent_dashboard_data`
**Migration Status:** ⚠️ **Partially migrated** - Dashboard loads but uses multiple API calls instead of single endpoint
**Known Issues:**
- Missing unified parent dashboard data endpoint
- Frontend makes multiple API calls (slower performance)

---

#### `/preparation-reunions` (Meeting Preparation)
**Module:** `spa/preparation_reunions.js` (77,639 lines - LARGEST MODULE)

**Interactions:**
1. **Select Date**
   - Calendar picker
   - View existing preparations
   - `GET /api/reunion-preparation?date=YYYY-MM-DD`
2. **Plan Activities**
   - Add activity items
   - Assign activity leaders
   - Set duration
   - Load from templates: `GET /api/activites-rencontre` (⚠️ MISSING)
3. **Assign Roles**
   - Assign animateurs (staff)
   - Load staff: `GET /api/animateurs`
4. **Set Louveteau d'Honneur**
   - Select participants for honor
5. **Save Preparation**
   - `POST /api/save-reunion-preparation` (⚠️ MISSING)
6. **Print View** - Printable meeting plan
7. **Copy from Previous** - Duplicate past meeting plan

**API Calls:**
- `GET /api/reunion-preparation?date=YYYY-MM-DD` - Get prep data ✓
- `POST /api/save-reunion-preparation` - Save prep ⚠️ MISSING
- `GET /api/activites-rencontre` - Get activity templates ⚠️ MISSING
- `GET /api/animateurs` - Get staff list ✓

**Original PHP:** `api.php?action=get_reunion_preparation`, `api.php?action=save_reunion_preparation`, `api.php?action=get_activites_rencontre`
**Migration Status:** ⚠️ **Partially migrated** - Can view preparations but cannot save
**Known Issues:**
- **CRITICAL:** Cannot save meeting preparations
- Missing activity templates endpoint
- Frontend likely caching data or using local storage

---

#### `/reports` (Reports & Analytics)
**Module:** `spa/reports.js` (25,359 lines)

**Interactions:**
1. **Health Report**
   - Allergies, medications, EpiPen carriers
   - Swimming levels
   - `GET /api/health-report` (⚠️ MISSING)
2. **Attendance Report**
   - Date range selection
   - Export to CSV
   - `GET /api/attendance-report` (⚠️ MISSING)
3. **Missing Documents Report**
   - Participants with incomplete forms
   - `GET /api/missing-documents-report` (⚠️ MISSING)
4. **Mailing List**
   - Email lists by role
   - `GET /api/mailing-list` ✓
5. **Parent Contact List**
   - Phone numbers, emails
   - `GET /api/parent-contact-list` ✓
6. **Points Report**
   - Leaderboard
   - `GET /api/points-report` (⚠️ MISSING)
7. **Honors Report**
   - Honor recipients by date
   - `GET /api/honors-report` (⚠️ MISSING)

**API Calls:**
- `GET /api/mailing-list` ✓ Migrated
- `GET /api/parent-contact-list` ✓ Migrated
- `GET /api/health-report` ⚠️ MISSING
- `GET /api/attendance-report` ⚠️ MISSING
- `GET /api/missing-documents-report` ⚠️ MISSING
- `GET /api/points-report` ⚠️ MISSING
- `GET /api/honors-report` ⚠️ MISSING

**Original PHP:** Multiple report actions (see PHP actions list)
**Migration Status:** ⚠️ **Partially migrated** - Only 2 of 7+ report types work
**Known Issues:**
- **CRITICAL:** Most report endpoints missing
- Frontend likely shows error messages or empty states

---

#### `/formulaire-inscription` (Registration Form)
**Module:** `spa/formulaire_inscription.js` (16,130 lines)

**Interactions:**
1. **Step 1: Participant Info**
   - First name, last name
   - Date of birth
   - Group selection
2. **Step 2: Guardian 1**
   - Name, email, phone
   - Relationship
3. **Step 3: Guardian 2** (optional)
   - Same fields as Guardian 1
4. **Step 4: Emergency Contacts**
   - Additional contacts
5. **Step 5: Permissions**
   - Photo consent
   - Can leave alone
6. **Submit Form**
   - `POST /api/save-form-submission` (⚠️ MISSING)
   - Creates participant + guardian records

**API Calls:**
- `GET /api/form-structure?form_type=participant_registration` (⚠️ MISSING)
- `POST /api/save-form-submission` (⚠️ MISSING)
- `POST /api/save-participant` (⚠️ MISSING - uses v1 API)

**Original PHP:** `api.php?action=get_form_structure`, `api.php?action=save_form_submission`, `api.php?action=save_participant`
**Migration Status:** ⚠️ **NOT MIGRATED** - Form likely not functional
**Known Issues:**
- **CRITICAL:** Form submission endpoints missing
- New registrations cannot be completed
- May use RESTful participant API partially

---

#### `/fiche-sante/:id` (Health Form)
**Module:** `spa/fiche_sante.js` (10,754 lines)

**Interactions:**
1. **Load Existing Data**
   - `GET /api/form-submissions?form_type=fiche_sante&participant_id=:id` (⚠️ MISSING)
2. **Form Fields:**
   - Allergies (text area)
   - Medications (list)
   - Health conditions
   - EpiPen required (checkbox)
   - Swimming level (dropdown)
   - Injuries/operations
3. **Save Form**
   - `POST /api/save-fiche-sante` (⚠️ MISSING)
   - Stores as JSONB in `form_submissions.submission_data`

**API Calls:**
- `GET /api/form-submissions?form_type=fiche_sante&participant_id=:id` (⚠️ MISSING)
- `POST /api/save-fiche-sante` (⚠️ MISSING)

**Original PHP:** `api.php?action=get_form_submission`, `api.php?action=save_fiche_sante`
**Migration Status:** ⚠️ **NOT MIGRATED**
**Known Issues:**
- **CRITICAL:** Health forms cannot be saved
- Parents cannot update medical information

---

#### `/acceptation-risque/:id` (Risk Acceptance Form)
**Module:** `spa/acceptation_risque.js` (7,898 lines)

**Interactions:**
1. **Load Existing Data**
   - `GET /api/get-acceptation-risque?participant_id=:id` (⚠️ MISSING)
2. **Form Fields:**
   - Activity acknowledgment
   - Risk understanding
   - Parent signature (digital)
   - Date
3. **Save Form**
   - `POST /api/save-acceptation-risque` (⚠️ MISSING)

**API Calls:**
- `GET /api/get-acceptation-risque?participant_id=:id` (⚠️ MISSING)
- `POST /api/save-acceptation-risque` (⚠️ MISSING)

**Original PHP:** `api.php?action=get_acceptation_risque`, `api.php?action=save_acceptation_risque`
**Migration Status:** ⚠️ **NOT MIGRATED**
**Known Issues:**
- **CRITICAL:** Risk acceptance forms cannot be saved
- Compliance/legal risk

---

#### `/admin` (Admin Panel)
**Module:** `spa/admin.js`

**Interactions:**
1. **User Management**
   - View pending users
   - `GET /api/users` ✓
   - Approve users: `POST /api/approve-user` (⚠️ MISSING)
   - Update user roles: `POST /api/update-user-role` (⚠️ MISSING)
2. **Organization Settings**
   - Edit organization name
   - Set registration password
   - `GET /api/organization-settings` ✓
   - `POST /api/save-organization-settings` (⚠️ MISSING)
3. **Form Format Configuration**
   - Customize form fields
   - `GET /api/organization-form-formats` (⚠️ MISSING)
   - `POST /api/save-form-format` (⚠️ MISSING)
4. **Push Notifications**
   - Send notifications to all users
   - `POST /api/send-notification` ✓

**API Calls:**
- `GET /api/users` ✓
- `GET /api/organization-settings` ✓
- `POST /api/send-notification` ✓
- `POST /api/approve-user` ⚠️ MISSING
- `POST /api/update-user-role` ⚠️ MISSING
- `POST /api/save-organization-settings` ⚠️ MISSING

**Original PHP:** `api.php?action=get_users`, `api.php?action=approve_user`, `api.php?action=update_user_role`
**Migration Status:** ⚠️ **Partially migrated**
**Known Issues:**
- **CRITICAL:** Cannot approve new users
- Cannot update user roles
- Cannot save organization settings

---

## Original PHP Implementation

### File Structure

```
Legacy PHP Files (Deprecated but retained for reference)
├── api.php (3,554 lines)
│   └── Main API endpoint with switch/case routing
├── config.php (70 lines)
│   └── Database connection, timezone, language loading
├── functions.php (11,080 lines)
│   └── Helper functions, authorization, business logic
├── jwt_auth.php (4,866 lines)
│   └── JWT generation and verification
├── index.php (3,791 lines)
│   └── Original entry point (now replaced by SPA)
├── get-news.php
├── get-organization-jwt.php
├── get_points_data.php
├── get_translations.php
├── initial-data.php
├── save-subscription.php
└── send-notification.php
```

### Original Architecture Pattern

**PHP Implementation used:**
1. **Action-based routing:** `/api.php?action=<action_name>`
2. **Global state:** Session-based authentication
3. **Direct SQL:** PDO with inline queries
4. **Monolithic:** All logic in single files
5. **Synchronous:** No async/await patterns

**Example PHP Request Flow:**
```
1. User clicks "Save Participant"
2. Frontend: fetch('/api.php?action=save_participant', {method: 'POST', body: ...})
3. api.php: $action = $_GET['action'] ?? '';
4. api.php: switch($action) { case 'save_participant': ... }
5. api.php: require_once 'functions.php'; require_once 'jwt_auth.php';
6. jwt_auth.php: verifyJWT($token)
7. functions.php: checkAuthorization()
8. api.php: Execute SQL with PDO
9. api.php: echo json_encode(['success' => true, 'data' => ...])
```

### Key PHP Functions

#### Authentication (jwt_auth.php)
- `generateJWT($userId, $userRole, $organizationId)` - Create JWT token
- `verifyJWT($token)` - Validate and decode JWT
- `getUserIdFromToken($token)` - Extract user ID from token
- `checkPermission($requiredRole)` - Role-based authorization

#### Database (functions.php)
- `getDbConnection()` - PDO connection factory
- `getCurrentOrganizationId()` - Get org ID from session/domain
- `executeQuery($sql, $params)` - Parameterized query execution
- `getParticipants($organizationId)` - Fetch all participants
- `getGroups($organizationId)` - Fetch all groups
- `getAttendance($date, $organizationId)` - Fetch attendance records

#### Business Logic (functions.php - 11,080 lines!)
- `saveParticipant($data)` - Create/update participant
- `assignParticipantToGroup($participantId, $groupId)` - Group assignment
- `updateAttendance($participantId, $date, $status)` - Mark attendance
- `awardHonor($participantId, $date)` - Award honor + 5 points
- `updatePoints($type, $id, $value)` - Add/subtract points
- `getFormSubmissions($formType, $participantId)` - Get JSONB form data
- `saveFormSubmission($formType, $participantId, $data)` - Save JSONB form
- `getGuardians($participantId)` - Get participant guardians
- `saveGuardian($participantId, $guardianData)` - Save guardian info
- `generateMailingList($organizationId)` - Generate email distribution list
- `getHealthReport($organizationId)` - Generate health report with allergies, etc.

#### Authorization (functions.php)
- `isAdmin()` - Check if current user is admin
- `isAnimation()` - Check if current user is staff
- `isParent()` - Check if current user is parent
- `canAccessParticipant($userId, $participantId)` - Check parent-child link

---

## Migration Comparison: PHP vs Node.js

### Architecture Changes

| Aspect | PHP (Original) | Node.js (Current) | Impact |
|--------|---------------|-------------------|--------|
| **Routing** | Action-based (`?action=X`) | RESTful (`/api/v1/resource`) + Legacy compatibility | ✓ Modern, but incomplete migration |
| **State Management** | Session-based | JWT stateless | ✓ Scalable, secure |
| **Database Access** | Direct PDO | Connection pooling (pg) | ✓ Better performance |
| **Authentication** | Session + JWT hybrid | Pure JWT | ✓ Stateless, multi-tenant friendly |
| **Authorization** | Function-based checks | Middleware (`authenticate`, `authorize`) | ✓ Centralized, reusable |
| **Error Handling** | PHP error handlers | Express error middleware | ✓ Consistent responses |
| **Logging** | `error_log()` | Winston logger | ✓ Structured logging |
| **API Documentation** | None | Swagger/OpenAPI | ✓ Self-documenting |
| **Code Organization** | Monolithic (single file) | Modular (routes, middleware, config) | ✓ Maintainable |

### Feature Parity Analysis

#### ✅ Fully Migrated & Working

1. **Authentication**
   - Login (JWT generation)
   - Session verification (JWT validation)
   - Role-based access control

2. **Participants**
   - List participants (with pagination, filtering)
   - Get participant details
   - Create participant
   - Update participant
   - Delete participant (soft delete)

3. **Groups**
   - List groups (with stats)
   - Get group details (with members)
   - Create group
   - Update group
   - Delete group

4. **Attendance**
   - Get attendance records (with filters)
   - Mark attendance (upsert)
   - Get attendance dates
   - Automatic point calculation

5. **Points**
   - Add points (individual)
   - Add points (group)
   - Get points data

6. **Honors**
   - View honors
   - Award honors (automatic +5 points)
   - Honor history

7. **Public Endpoints**
   - Translations
   - News
   - Organization JWT
   - Organization ID

8. **Utilities**
   - Mailing list generation
   - Parent contact list
   - Push notifications
   - Initial data bootstrap

#### ⚠️ Partially Migrated (Working but Incomplete)

1. **User Management**
   - ✓ List users
   - ✗ Approve users
   - ✗ Update user roles
   - ✗ Link users to participants

2. **Meeting Preparation**
   - ✓ View preparations
   - ✗ Save preparations
   - ✗ Activity templates

3. **Reports**
   - ✓ Mailing list
   - ✓ Parent contacts
   - ✗ Health report
   - ✗ Attendance report
   - ✗ Missing documents report
   - ✗ 5+ other reports

4. **Calendar/Payments**
   - ✓ View calendars
   - ✗ Update calendar entries
   - ✗ Mark payments
   - ✗ Track payment amounts

5. **Parent Dashboard**
   - ✓ View children (uses multiple API calls)
   - ✗ Unified dashboard data endpoint

#### ❌ Not Migrated (Missing)

1. **Forms System** (CRITICAL)
   - ❌ Get form structure
   - ❌ Get form submissions
   - ❌ Save form submissions
   - ❌ Custom form formats
   - ❌ Health form (fiche_sante)
   - ❌ Risk acceptance form
   - ❌ Guardian form submissions

2. **Badge System** (CRITICAL)
   - ❌ Get badge progress
   - ❌ Save badge progress
   - ❌ Approve badges
   - ❌ Badge applications

3. **Guardian Management**
   - ❌ Get guardians
   - ❌ Save guardian info
   - ❌ Remove guardians
   - ❌ Link guardians to participants

4. **Organization Management**
   - ❌ Create organization
   - ❌ Switch organization
   - ❌ Register for organization
   - ❌ Organization settings (save)
   - ❌ Custom form formats

5. **User-Participant Linking**
   - ❌ Link parent to child
   - ❌ Associate user with participant
   - ❌ Get user's children

6. **Reports (Most)**
   - ❌ Health contact report
   - ❌ Attendance report
   - ❌ Allergies report
   - ❌ Medication report
   - ❌ Vaccine report
   - ❌ Leave alone permissions report
   - ❌ Media authorization report
   - ❌ Missing documents report
   - ❌ Points report
   - ❌ Honors report

7. **Password Reset**
   - ❌ Request password reset
   - ❌ Reset password with token

8. **Additional Features**
   - ❌ User registration (backend endpoint)
   - ❌ Get activity templates
   - ❌ Save meeting reminders
   - ❌ Get meeting reminders
   - ❌ Update participant group assignment

### Code Comparison Examples

#### Example 1: Login Endpoint

**PHP (api.php):**
```php
case 'login':
    $email = strtolower($_POST['email']);
    $password = $_POST['password'];

    $stmt = $pdo->prepare("SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
                           FROM users u
                           JOIN user_organizations uo ON u.id = uo.user_id
                           WHERE u.email = ? AND uo.organization_id = ?");
    $stmt->execute([$email, getCurrentOrganizationId()]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user || !password_verify($password, $user['password'])) {
        jsonResponse(false, null, 'Invalid email or password');
    }

    $token = generateJWT($user['id'], $user['role'], getCurrentOrganizationId());
    jsonResponse(true, ['token' => $token, 'user_role' => $user['role']], 'login_successful');
    break;
```

**Node.js (api.js):**
```javascript
app.post('/public/login', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);
    const { email, password } = req.body;

    const normalizedEmail = email.toLowerCase();
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE u.email = $1 AND uo.organization_id = $2`,
      [normalizedEmail, organizationId]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Convert PHP $2y$ bcrypt hash to Node.js compatible $2a$ format
    const nodeCompatibleHash = user.password.replace(/^\$2y\$/, '$2a$');
    const passwordValid = await bcrypt.compare(password, nodeCompatibleHash);

    if (!passwordValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { user_id: user.id, user_role: user.role, organizationId },
      jwtKey,
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, user_role: user.role, message: 'login_successful' });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
```

**Improvements:**
- ✓ Async/await for better error handling
- ✓ Proper HTTP status codes (401, 500)
- ✓ Winston logging instead of error_log
- ✓ Standardized JSON response format
- ✓ Bcrypt compatibility handling ($2y$ → $2a$)

#### Example 2: Get Participants

**PHP (api.php):**
```php
case 'get_participants':
    $organizationId = getCurrentOrganizationId();
    $stmt = $pdo->prepare("
        SELECT p.id, p.first_name, p.last_name, pg.group_id, g.name as group_name,
               COALESCE(SUM(pt.value), 0) as total_points
        FROM participants p
        JOIN participant_organizations po ON p.id = po.participant_id
        LEFT JOIN participant_groups pg ON p.id = pg.participant_id
        LEFT JOIN groups g ON pg.group_id = g.id
        LEFT JOIN points pt ON p.id = pt.participant_id
        WHERE po.organization_id = ?
        GROUP BY p.id, p.first_name, p.last_name, pg.group_id, g.name
        ORDER BY p.first_name
    ");
    $stmt->execute([$organizationId]);
    $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse(true, $participants);
    break;
```

**Node.js (routes/participants.js):**
```javascript
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationId(req, pool);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const groupId = req.query.group_id;

  let query = `
    SELECT p.*, pg.group_id, g.name as group_name
    FROM participants p
    JOIN participant_organizations po ON p.id = po.participant_id
    LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
    LEFT JOIN groups g ON pg.group_id = g.id
    WHERE po.organization_id = $1
  `;

  const params = [organizationId];

  if (groupId) {
    query += ` AND pg.group_id = $${params.length + 1}`;
    params.push(groupId);
  }

  query += ` ORDER BY p.first_name, p.last_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT p.id) as total FROM participants p
     JOIN participant_organizations po ON p.id = po.participant_id
     WHERE po.organization_id = $1`,
    [organizationId]
  );

  const total = parseInt(countResult.rows[0].total);

  return paginated(res, result.rows, page, limit, total);
}));
```

**Improvements:**
- ✓ Pagination support (better performance for large datasets)
- ✓ Filtering by group
- ✓ Middleware authentication
- ✓ Modular route file (not monolithic)
- ✓ Standardized paginated response
- ✓ Async error handling with asyncHandler

#### Example 3: Update Attendance

**PHP (api.php):**
```php
case 'update_attendance':
    $data = json_decode(file_get_contents('php://input'), true);
    $participantId = $data['participant_id'];
    $date = $data['date'];
    $status = $data['status'];
    $organizationId = getCurrentOrganizationId();

    // Upsert attendance
    $stmt = $pdo->prepare("
        INSERT INTO attendance (participant_id, organization_id, date, status)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (participant_id, organization_id, date)
        DO UPDATE SET status = ?
    ");
    $stmt->execute([$participantId, $organizationId, $date, $status, $status]);

    jsonResponse(true, null, 'Attendance updated');
    break;
```

**Node.js (routes/attendance.js):**
```javascript
router.post('/', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
  const { participant_id, date, status, previous_status } = req.body;
  const organizationId = await getOrganizationId(req, pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert attendance
    const result = await client.query(
      `INSERT INTO attendance (participant_id, date, status, organization_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (participant_id, date, organization_id)
       DO UPDATE SET status = $3
       RETURNING *`,
      [participant_id, date, status, organizationId]
    );

    // Calculate point adjustment if status changed
    if (previous_status && previous_status !== status) {
      const pointValues = { present: 1, late: 0.5, absent: 0, excused: 0 };
      const adjustment = (pointValues[status] || 0) - (pointValues[previous_status] || 0);

      if (adjustment !== 0) {
        await client.query(
          `INSERT INTO points (participant_id, value, created_at, organization_id)
           VALUES ($1, $2, NOW(), $3)`,
          [participant_id, adjustment, organizationId]
        );
      }
    }

    await client.query('COMMIT');

    return success(res, result.rows[0], 'Attendance marked successfully', 201);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));
```

**Improvements:**
- ✓ Automatic point calculation based on status change
- ✓ Database transactions (ACID compliance)
- ✓ Role-based authorization middleware
- ✓ Proper error rollback
- ✓ Connection pooling with explicit release

---

## Database Schema

### Key Tables

#### participants
```sql
CREATE TABLE participants (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_naissance DATE,  -- Note: Inconsistent naming (French vs English)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### groups
```sql
CREATE TABLE groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### participant_groups (Many-to-Many)
```sql
CREATE TABLE participant_groups (
  participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  is_leader BOOLEAN DEFAULT FALSE,
  is_second_leader BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (participant_id, group_id, organization_id)
);
```

#### attendance
```sql
CREATE TABLE attendance (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (participant_id, organization_id, date)
);
```

#### points
```sql
CREATE TABLE points (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  value NUMERIC(5,2) NOT NULL,  -- Supports 0.5 points for "late"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### honors
```sql
CREATE TABLE honors (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### form_submissions (JSONB for flexible forms)
```sql
CREATE TABLE form_submissions (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  form_type VARCHAR(50) NOT NULL,
  submission_data JSONB NOT NULL,  -- Flexible schema
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Example submission_data for fiche_sante:
{
  "allergie": "Arachides, pollen",
  "epipen": true,
  "probleme_sante": "Asthme léger",
  "niveau_natation": "Intermédiaire",
  "blessures_operations": "None",
  "medications": [
    {"name": "Ventolin", "dosage": "2 puffs as needed"}
  ]
}
```

#### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,  -- Bcrypt hash
  full_name VARCHAR(255),
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### user_organizations (Multi-tenancy)
```sql
CREATE TABLE user_organizations (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'animation', 'parent')),
  PRIMARY KEY (user_id, organization_id)
);
```

#### organizations
```sql
CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### organization_domains (Domain-based tenant resolution)
```sql
CREATE TABLE organization_domains (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Database Relationships

```
organizations (1) ──< (N) user_organizations (N) >── (1) users
     │
     ├──< (N) participant_organizations (N) >── (1) participants
     │                                                    │
     ├──< (N) groups                                     │
     │         │                                          │
     │         └──< (N) participant_groups >──────────────┘
     │
     ├──< (N) attendance
     ├──< (N) points
     ├──< (N) honors
     ├──< (N) form_submissions
     ├──< (N) organization_settings
     └──< (N) organization_form_formats
```

---

## Authentication & Authorization

### JWT Token Structure

```javascript
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",  // UUID
  "user_role": "animation",  // admin | animation | parent
  "organizationId": 1,
  "iat": 1733097600,  // Issued at
  "exp": 1733702400   // Expires (7 days)
}
```

### Authorization Levels

| Role | Permissions |
|------|-------------|
| **Admin** | Full access: manage users, settings, participants, groups, attendance, points, honors, reports |
| **Animation** (Staff) | Manage participants, groups, attendance, points, honors, meeting prep, reports (read-only settings) |
| **Parent** | View own children's data, update health forms, submit badge applications (no access to other participants) |

### Middleware Flow

```
Request → authenticate (verify JWT) → authorize (check role) → route handler
```

**authenticate middleware:**
```javascript
// middleware/auth.js
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const decoded = jwt.verify(token, jwtKey);
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  req.user = decoded;
  next();
};
```

**authorize middleware:**
```javascript
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.user_role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
};
```

**Usage:**
```javascript
router.post('/', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
  // Only admins and animation staff can access this endpoint
}));
```

---

## Known Issues & Missing Features

### Critical Issues

1. **Forms System Completely Non-Functional** 🔴
   - Health forms (fiche_sante) cannot be saved
   - Risk acceptance forms cannot be saved
   - Registration forms may not work properly
   - Guardian forms missing
   - **Impact:** New member registration broken, compliance risk (health info)

2. **Meeting Preparation Cannot Save** 🔴
   - Staff can view past preparations but cannot create new ones
   - Activity templates missing
   - **Impact:** Staff workflow broken, must use external tools

3. **Badge System Missing** 🔴
   - Badge progress tracking not migrated
   - Badge approval workflow missing
   - **Impact:** Key scouting feature unavailable

4. **Report Generation Limited** 🟡
   - Only 2 of 10+ reports work
   - Health reports missing (allergies, medications, etc.)
   - Attendance reports missing
   - **Impact:** Limited analytics, manual reporting required

5. **User Management Incomplete** 🟡
   - Cannot approve new user registrations
   - Cannot update user roles
   - **Impact:** Admin must use database directly

6. **Guardian Management Missing** 🔴
   - Cannot view/edit guardian information
   - Cannot link guardians to participants
   - **Impact:** Emergency contact info incomplete

### Data Integrity Issues

1. **Inconsistent Naming** 🟡
   - `date_naissance` (French) vs `date_of_birth` (English) in different places
   - Some APIs use `participant_id`, others use `participantId`
   - **Impact:** Confusion, potential bugs

### Recently Fixed Issues (December 2025) ✅

1. **Point Adjustment Bug** ✅ RESOLVED
   - Fixed error 500 when adding points to individuals (Commit c2a0fc0)
   - Participant ID mapping corrected to match frontend expectations
   - Group point distribution now working correctly

2. **Attendance Point Calculation** ✅ RESOLVED
   - Configurable point system implemented (Commit 397eea1)
   - Default: present=+1, late=0, absent=0, excused=0
   - Organizations can customize via `organization_settings` table
   - Previous status tracking implemented for accurate point adjustments

3. **Point Persistence Across Navigation** ✅ RESOLVED
   - Cache invalidation strategy implemented (Commit ddf75fc)
   - Cache duration reduced from 24 hours to 5 minutes
   - Multi-cache clearing ensures fresh data after updates

4. **Group Point Distribution** ✅ RESOLVED
   - Group points now distributed to individual members (Commit 4c8a180)
   - Dual tracking: maintains both group totals and member totals
   - UI updates reflect both group and individual contributions

### Performance Concerns

1. **Large Module Files** ⚠️
   - `preparation_reunions.js` is 77,639 lines (!)
   - `manage_points.js` is 25,987 lines
   - `ajax-functions.js` is 33,410 lines
   - **Impact:** Slow load times, hard to maintain

2. **Parent Dashboard Multiple API Calls** 🟡
   - Makes 5+ separate API calls instead of single optimized endpoint
   - **Impact:** Slower load time for parents

3. **No Query Optimization** 🟡
   - Some endpoints missing database indexes
   - N+1 query problems in some reports
   - **Impact:** Slow with large datasets

### Security Concerns

1. **Organization ID from Hostname** ⚠️
   - Falls back to organization_id = 1 if domain not found
   - Potential cross-organization data leak
   - **Impact:** Security risk in multi-tenant environment

2. **No Rate Limiting on Sensitive Endpoints** 🟡
   - Login endpoint has general rate limiting but not specific
   - **Impact:** Brute force vulnerability

3. **CORS Wide Open** ⚠️
   - `app.use(cors())` allows all origins
   - **Impact:** CSRF vulnerability

### Missing Features from Original PHP

**High Priority:**
- Form submission system (9 endpoints)
- Badge progress tracking (5 endpoints)
- Guardian management (5 endpoints)
- User approval workflow
- Meeting preparation save
- Most reports (9 endpoints)

**Medium Priority:**
- Organization switching
- User-participant linking
- Password reset
- Calendar/payment updates
- Activity templates

**Low Priority:**
- Get current stars
- Get recent honors
- Various specialized reports

---

## Recommendations & Roadmap

### Recently Completed (December 2025) ✅

The following improvements have been successfully implemented:

1. **Configurable Point System** ✅ COMPLETE
   - Organizations can customize point values via database settings
   - Implemented `getPointSystemRules()` function in api.js
   - Endpoints updated: `/api/award-honor`, `/api/update-attendance`, `/api/update-points`
   - Default rules with fallback handling

2. **Group Point Distribution** ✅ COMPLETE
   - Group points automatically distributed to all members
   - Dual tracking: group-level and individual totals
   - Frontend UI updated to show both totals
   - Response includes `memberTotals` array

3. **Cache Optimization** ✅ COMPLETE
   - Implemented `clearPointsRelatedCaches()` function
   - Cache duration reduced: 24 hours → 5 minutes
   - Multi-cache invalidation on point updates
   - Points now persist correctly across navigation

4. **Point Bug Fixes** ✅ COMPLETE
   - Fixed error 500 when adding points to individuals
   - Corrected participant ID mapping
   - Improved point calculation accuracy
   - Transaction safety for all point operations

### Immediate Actions (Critical Fixes)

1. **Implement Forms System** 🔴
   ```
   Priority: CRITICAL
   Effort: High (2-3 weeks)

   Endpoints to create:
   - GET /api/form-structure?form_type=X
   - GET /api/form-submissions?form_type=X&participant_id=Y
   - POST /api/save-form-submission
   - POST /api/save-fiche-sante
   - POST /api/save-acceptation-risque
   ```

2. **Fix Meeting Preparation Save** 🔴
   ```
   Priority: CRITICAL
   Effort: Medium (1 week)

   Endpoints to create:
   - POST /api/save-reunion-preparation
   - GET /api/activites-rencontre (activity templates)
   ```

3. **Implement Guardian Management** 🔴
   ```
   Priority: CRITICAL
   Effort: Medium (1 week)

   Endpoints to create:
   - GET /api/guardians?participant_id=X
   - POST /api/save-guardian
   - DELETE /api/remove-guardian
   ```

4. **Fix Security Issues** 🔴
   ```
   Priority: CRITICAL
   Effort: Low (2-3 days)

   Actions:
   - Restrict CORS to specific domains
   - Add stricter organization ID validation
   - Add login rate limiting (5 attempts/15 min)
   - Validate all organization_id access
   ```

### Short-Term Improvements (1-2 months)

5. **Implement Badge System** 🟡
   ```
   Priority: HIGH
   Effort: Medium (2 weeks)

   Endpoints to create:
   - GET /api/badge-progress?participant_id=X
   - POST /api/save-badge-progress
   - GET /api/pending-badges
   - POST /api/approve-badge
   ```

6. **Complete User Management** 🟡
   ```
   Priority: HIGH
   Effort: Low (3-4 days)

   Endpoints to create:
   - POST /api/approve-user
   - POST /api/update-user-role
   - POST /api/link-user-participants
   ```

7. **Implement Missing Reports** 🟡
   ```
   Priority: HIGH
   Effort: Medium (1-2 weeks)

   Reports to create:
   - Health report (allergies, medications, EpiPen)
   - Attendance report (date range, export CSV)
   - Missing documents report
   - Points leaderboard report
   - Honors history report
   ```

8. **Optimize Parent Dashboard** 🟡
   ```
   Priority: MEDIUM
   Effort: Low (2-3 days)

   Create single endpoint:
   - GET /api/parent-dashboard?user_id=X
     Returns: children, attendance, points, badges, forms in one call
   ```

### Long-Term Enhancements (3-6 months)

9. **Code Splitting & Performance** 🟡
   ```
   Priority: MEDIUM
   Effort: Medium (1-2 weeks)

   Actions:
   - Split large modules (preparation_reunions.js, manage_points.js)
   - Implement lazy loading for heavy components
   - Add database indexes on commonly queried columns
   - Implement Redis caching for frequently accessed data
   ```

10. **Database Optimization** 🟡
    ```
    Priority: MEDIUM
    Effort: Medium (1-2 weeks)

    Actions:
    - Add indexes on: participants.organization_id, attendance.date, points.participant_id
    - Normalize naming (date_naissance → date_of_birth)
    - Add database constraints for data integrity
    - Implement database connection health checks
    ```

11. **API Versioning Strategy** 🟡
    ```
    Priority: LOW
    Effort: Medium (1-2 weeks)

    Actions:
    - Deprecate legacy endpoints (/api/participants → /api/v1/participants)
    - Set sunset dates for old endpoints
    - Provide migration guide for frontend
    ```

12. **Testing & CI/CD** 🟡
    ```
    Priority: MEDIUM
    Effort: High (3-4 weeks)

    Actions:
    - Add integration tests for all API endpoints
    - Add unit tests for business logic
    - Set up CI/CD pipeline (GitHub Actions)
    - Implement code coverage tracking (target: 80%)
    ```

### Migration Completion Roadmap

**Phase 0: Point System Enhancements** ✅ **COMPLETED** (December 2025)
- ✅ Configurable point system
- ✅ Group point distribution to members
- ✅ Cache optimization for point persistence
- ✅ Point calculation bug fixes
- ✅ Transaction safety for point operations

**Phase 1: Critical Fixes** 🔴 **IN PROGRESS**
- ⬜ Forms system (9 endpoints)
- ⬜ Meeting preparation save (2 endpoints)
- ⬜ Guardian management (5 endpoints)
- ⬜ Security fixes (CORS, rate limiting, validation)
- **Status:** 0 of 16 items completed
- **Estimated Duration:** 6-8 weeks

**Phase 2: User Experience** 🟡 **PENDING**
- ⬜ Badge system (5 endpoints)
- ⬜ User management completion (3 endpoints)
- ⬜ Parent dashboard optimization (1 unified endpoint)
- ⬜ Missing reports (7+ report types)
- **Status:** Blocked by Phase 1 completion
- **Estimated Duration:** 4-6 weeks

**Phase 3: Code Quality** 🟡 **PENDING**
- ⬜ Code splitting (large modules)
- ⬜ Database optimization (indexes, naming)
- ⬜ Testing coverage (target: 80%)
- ⬜ Performance tuning (caching, queries)
- **Status:** Can start in parallel with Phase 2
- **Estimated Duration:** 6-8 weeks

**Phase 4: Deprecation** 🟡 **PENDING**
- ⬜ Remove legacy PHP files
- ⬜ Complete API versioning
- ⬜ Full migration to RESTful v1 API
- ⬜ Final documentation updates
- **Status:** Blocked by Phase 1-2 completion
- **Estimated Duration:** 2-3 weeks

**Overall Migration Status:**
- **Core Features:** ✅ Complete (participants, groups, attendance, points, honors)
- **Point System:** ✅ Enhanced and optimized
- **Forms/Badges:** ❌ Not yet migrated (critical gap)
- **Reports:** ⚠️ Partially migrated (2 of 10+)
- **Estimated Completion:** Phase 1-4: 4-6 months with dedicated effort

---

## Appendix: Endpoint Reference

### Complete Node.js API Endpoint List

#### RESTful v1 API
```
GET    /api/v1/participants
GET    /api/v1/participants/:id
POST   /api/v1/participants
PUT    /api/v1/participants/:id
DELETE /api/v1/participants/:id

GET    /api/v1/groups
GET    /api/v1/groups/:id
POST   /api/v1/groups
PUT    /api/v1/groups/:id
DELETE /api/v1/groups/:id

GET    /api/v1/attendance
GET    /api/v1/attendance/dates
POST   /api/v1/attendance
```

#### Legacy-Compatible API (Migrated)
```
GET    /api/translations
GET    /api/news
GET    /api/organization-jwt
POST   /public/login
GET    /public/get_organization_id
GET    /api/organization-settings
GET    /api/reunion-preparation
GET    /api/points-data
GET    /api/initial-data
POST   /api/push-subscription
POST   /api/send-notification
GET    /api/participants
GET    /api/get_groups
GET    /api/honors
POST   /api/award-honor
GET    /api/attendance
POST   /api/update-attendance
POST   /api/update-points
GET    /api/guests-by-date
POST   /api/save-guest
GET    /api/get_reminder
POST   /api/save_reminder
GET    /api/reunion-dates
GET    /api/attendance-dates
GET    /api/participant-details
GET    /api/mailing-list
GET    /api/calendars
GET    /api/next-meeting-info
GET    /api/animateurs
GET    /api/parent-contact-list
GET    /api/users
GET    /api/participants-with-users
GET    /api/parent-users
```

#### Missing Endpoints (from PHP)
```
❌ POST   /api/approve-user
❌ POST   /api/update-user-role
❌ POST   /api/link-user-participants
❌ GET    /api/form-structure
❌ GET    /api/form-submissions
❌ POST   /api/save-form-submission
❌ POST   /api/save-fiche-sante
❌ GET    /api/get-acceptation-risque
❌ POST   /api/save-acceptation-risque
❌ GET    /api/guardians
❌ POST   /api/save-guardian
❌ DELETE /api/remove-guardian
❌ GET    /api/badge-progress
❌ POST   /api/save-badge-progress
❌ GET    /api/pending-badges
❌ POST   /api/approve-badge
❌ POST   /api/save-reunion-preparation
❌ GET    /api/activites-rencontre
❌ GET    /api/health-report
❌ GET    /api/attendance-report
❌ GET    /api/missing-documents-report
❌ GET    /api/points-report
❌ GET    /api/honors-report
❌ POST   /api/create-organization
❌ POST   /api/register-for-organization
❌ POST   /api/request-reset
❌ POST   /api/reset-password
... and 30+ more
```

---

## Conclusion

The Wampums Scout Management System has undergone a progressive migration from PHP to Node.js with significant recent achievements:

**Recent Successes (December 2025):**
- ✅ **Configurable Point System**: Organizations can now customize point values for attendance, honors, and badges
- ✅ **Group Point Distribution**: Automatic distribution to members with dual tracking
- ✅ **Cache Optimization**: Points persist correctly across navigation with intelligent invalidation
- ✅ **Bug Fixes**: Resolved error 500 on individual points, improved calculation accuracy

**Overall Successes:**
- ✅ Core functionality migrated (participants, groups, attendance, points, honors)
- ✅ Modern architecture (RESTful API, JWT auth, connection pooling)
- ✅ Improved security and scalability
- ✅ Better code organization and maintainability
- ✅ API documentation with Swagger
- ✅ Enhanced point system with configurability and reliability

**Remaining Challenges:**
- ❌ 68% of original endpoints not yet migrated (62 of 91)
- ❌ Critical features missing (forms, badges, guardians)
- ❌ User workflows broken (meeting prep save, user approval)
- ❌ Limited reporting capabilities

**Migration Progress:**
- **Phase 0 (Point System):** ✅ **100% Complete**
- **Phase 1 (Critical Fixes):** 🔴 **0% Complete** - Next priority
- **Phase 2 (User Experience):** 🟡 **Pending**
- **Phase 3 (Code Quality):** 🟡 **Pending**
- **Phase 4 (Deprecation):** 🟡 **Pending**

**Overall Migration Status: ~35% Complete**
- Core features: ✅ Complete and enhanced
- Point system: ✅ Fully optimized
- Forms/Badges: ❌ Not migrated (critical gap)
- Reports: ⚠️ Partially migrated

The system is currently in a **transitional state** where basic operations work well (especially the recently enhanced point system), but many important features remain unavailable. The recent point system improvements demonstrate the benefits of the Node.js architecture: better configurability, transaction safety, and intelligent caching.

**Recommended Next Steps:**
1. **Implement forms system** (CRITICAL) - Health forms, registration, risk acceptance
2. **Fix security issues** - CORS, rate limiting, validation
3. **Implement guardian management** - Emergency contacts, parent-child links
4. **Complete user management** - User approval workflow, role updates
5. **Restore meeting preparation save** - Activity planning workflow

**Timeline to Full Migration:**
- Phase 1 (Critical): 6-8 weeks
- Phase 2 (UX): 4-6 weeks
- Phase 3 (Quality): 6-8 weeks (parallel with Phase 2)
- Phase 4 (Deprecation): 2-3 weeks
- **Total: 4-6 months with dedicated development effort**

**Next Documentation Update:** After Phase 1 completion

---

**Document Version:** 2.0
**Last Updated:** 2025-12-01
**Branch:** claude/update-architecture-docs-01CLgTWSHKjsa3E36MzfaEuK
**Recent Changes:** Added Configurable Point System section, updated roadmap with Phase 0 completion
**Maintained By:** Development Team
**Contact:** info@christiansabourin.com
