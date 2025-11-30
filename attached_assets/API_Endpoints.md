# API Endpoints

This document lists all available API endpoints for the Scout Organization App.

## Base URLs

- **Public Routes**: `/` (no authentication required)
- **API Routes**: `/api` (authentication required via JWT token)

---

## Public Endpoints (No Authentication)

### Connection & Organization

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/test-connection` | Test database connection |
| GET | `/public/get_organization_id` | Get organization ID based on hostname |
| GET | `/public/organization-settings` | Get organization settings |
| GET | `/public/get_news` | Get news for the organization |
| GET | `/public/initial-data` | Get initial data for frontend |

### Authentication

| Method | Endpoint | Description | Body Parameters |
|--------|----------|-------------|-----------------|
| POST | `/public/login` | User login | `email`, `password` |
| POST | `/public/register` | Register new user | `email`, `password`, `full_name`, `account_creation_password`, `user_type` |
| POST | `/public/verify-email` | Verify email address | `verification_token` |
| POST | `/public/request_reset` | Request password reset | `email` |
| POST | `/public/reset_password` | Reset password | `reset_token`, `new_password` |
| POST | `/public/authenticate` | API key authentication | API key in headers |

---

## Protected API Endpoints (JWT Required)

All endpoints below require a valid JWT token in the `Authorization` header:
```
Authorization: Bearer <token>
```

### Authentication & Users

| Method | Endpoint | Description | Body Parameters |
|--------|----------|-------------|-----------------|
| POST | `/api/login` | Login | `email`, `password` |
| POST | `/api/register` | Register | `email`, `password`, `full_name`, `account_creation_password`, `user_type` |
| POST | `/api/verify-email` | Verify email | `verification_token` |
| POST | `/api/request-reset` | Request password reset | `email` |
| POST | `/api/reset-password` | Reset password | `reset_token`, `new_password` |
| POST | `/api/refresh-token` | Refresh JWT token | - |
| POST | `/api/logout` | Logout | - |
| GET | `/api/users` | Get all users | - |
| POST | `/api/check-permission` | Check user permission | - |
| POST | `/api/approve-user` | Approve user (admin only) | `user_id` |
| POST | `/api/update-user-role` | Update user role (admin only) | `user_id`, `new_role` |

### Participants

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/participants` | Get all participants | - |
| GET | `/api/participant/:id` | Get participant by ID | - |
| GET | `/api/participant-details` | Get participant details | Query: `participant_id` |
| POST | `/api/save-participant` | Save/update participant | `first_name`, `last_name`, `date_naissance` |
| GET | `/api/participant-age` | Get participant age report | - |
| GET | `/api/participants-with-users` | Get participants with linked users | - |
| POST | `/api/link-participant-to-organization` | Link participant to org | `participant_id` |
| POST | `/api/remove-participant-from-organization` | Remove participant (admin only) | `participant_id` |
| POST | `/api/associate-user` | Associate user to participant | `participant_id`, `user_id` |
| POST | `/api/link-user-participants` | Link user to participants | `participant_ids` (array) |

### Guardians

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/guardians` | Get all guardians | - |
| GET | `/api/guardian-info` | Get guardian info | Query: `guardian_id` |
| GET | `/api/guardians-for-participant` | Get guardians for participant | Query: `participant_id` |
| POST | `/api/save-parent` | Save parent/guardian | `participant_id` + guardian data |
| POST | `/api/save-guardian-form-submission` | Save guardian form | `participant_id`, `submission_data` |
| POST | `/api/link-parent-to-participant` | Link parent to participant | `parent_id`, `participant_id` |
| POST | `/api/remove-guardians` | Remove guardians | `participant_id`, `guardian_ids` (array) |
| GET | `/api/parent-users` | Get parent users | - |
| GET | `/api/parent-dashboard-data` | Get parent dashboard data | - |
| GET | `/api/parent-contact-list` | Get parent contact list | - |

### Groups

| Method | Endpoint | Description | Body Parameters |
|--------|----------|-------------|-----------------|
| GET | `/api/get_groups` | Get all groups | - |
| POST | `/api/add-group` | Add new group | `group_name` |
| POST | `/api/remove-group` | Remove group | `group_id` |
| POST | `/api/update-group-name` | Update group name | `group_id`, `group_name` |
| POST | `/api/update-participant-group` | Update participant's group | `participant_id`, `group_id` |
| POST | `/api/update-points` | Update points | Array of: `type`, `id`, `points`, `timestamp` |
| GET | `/api/points-report` | Get points report | - |

#### Update Points Request Format
```json
[
  {
    "type": "individual",
    "id": "69",
    "points": 1,
    "timestamp": "2025-09-14T16:00:32.672Z"
  }
]
```

### Forms

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/form-types` | Get form types | - |
| GET | `/api/form-structure` | Get form structure | Query: `form_type` |
| GET | `/api/form-submission` | Get form submission | Query: `participant_id`, `form_type` |
| GET | `/api/form-submissions` | Get all form submissions | - |
| POST | `/api/save-form-submission` | Save form submission | `form_type`, `participant_id`, `submission_data` |
| GET | `/api/organization-form-formats` | Get org form formats | - |
| GET | `/api/fiche-sante` | Get health form | Query: `participant_id` |
| POST | `/api/save-fiche-sante` | Save health form | `participant_id` + form data |
| GET | `/api/acceptation-risque` | Get risk acceptance form | Query: `participant_id` |
| POST | `/api/save-acceptation-risque` | Save risk acceptance | `participant_id` + form data |

### Badges

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/badge-progress` | Get badge progress | Query: `participant_id` |
| POST | `/api/save-badge-progress` | Save badge progress | `participant_id`, `territoire_chasse` |
| GET | `/api/pending-badges` | Get pending badges | - |
| GET | `/api/current-stars` | Get current stars | - |
| POST | `/api/approve-badge` | Approve badge | `badge_id` |
| POST | `/api/reject-badge` | Reject badge | `badge_id` |
| GET | `/api/badge-summary` | Get badge summary | - |
| GET | `/api/badge-history` | Get badge history | Query: `participant_id` |

### Honors

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/honors` | Get honors | - |
| GET | `/api/recent-honors` | Get recent honors | - |
| POST | `/api/award-honor` | Award honor | `participantId`, `date` |
| GET | `/api/honors-report` | Get honors report | - |
| GET | `/api/available-dates` | Get available dates | - |

### Attendance

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/attendance` | Get attendance | Query: `date` |
| POST | `/api/update-attendance` | Update attendance | `participant_id`, `status`, `date` |
| GET | `/api/attendance-dates` | Get attendance dates | - |
| GET | `/api/attendance-report` | Get attendance report | - |
| POST | `/api/save-guest` | Save guest | `name`, `attendance_date` |
| GET | `/api/guests-by-date` | Get guests by date | Query: `date` |

#### Attendance Status Values
- `present`
- `absent`
- `excused`
- `late`
- `non-motivated`

### Calendar

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/calendars` | Get calendars | - |
| POST | `/api/update-calendar` | Update calendar | `participant_id`, `amount` |
| POST | `/api/update-calendar-paid` | Update paid status | `participant_id`, `paid_status` |
| POST | `/api/update-calendar-amount-paid` | Update amount paid | `participant_id`, `amount_paid` |
| GET | `/api/participant-calendar` | Get participant calendar | Query: `participant_id` |

### Reunions

| Method | Endpoint | Description | Body/Query Parameters |
|--------|----------|-------------|----------------------|
| GET | `/api/reunion-preparation` | Get reunion preparation | Query: `date` |
| POST | `/api/save-reunion-preparation` | Save reunion prep | `date` + preparation data |
| GET | `/api/reunion-dates` | Get reunion dates | - |
| GET | `/api/activites-rencontre` | Get meeting activities | - |
| POST | `/api/save-reminder` | Save reminder | `reminder_date`, `reminder_text` |
| GET | `/api/reminder` | Get reminder | Query: `date` |
| GET | `/api/next-meeting-info` | Get next meeting info | - |
| GET | `/api/animateurs` | Get animators | - |

### Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health-contact-report` | Get health contact report |
| GET | `/api/health-report` | Get health report |
| GET | `/api/allergies-report` | Get allergies report |
| GET | `/api/medication-report` | Get medication report |
| GET | `/api/vaccine-report` | Get vaccine report |
| GET | `/api/leave-alone-report` | Get leave alone authorization report |
| GET | `/api/media-authorization-report` | Get media authorization report |
| GET | `/api/missing-documents-report` | Get missing documents report |
| GET | `/api/mailing-list` | Get mailing list |

### Organization

| Method | Endpoint | Description | Body Parameters |
|--------|----------|-------------|-----------------|
| GET | `/api/get-organization-id` | Get organization ID | - |
| POST | `/api/create-organization` | Create organization | `name` |
| POST | `/api/switch-organization` | Switch organization | `organization_id` |
| GET | `/api/organization-settings` | Get org settings | - |
| GET | `/api/news` | Get news | - |

### Utility

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/test-connection` | Test database connection |
| GET | `/api/initial-data` | Get initial data |
| GET | `/api/subscribers` | Get subscribers |

---

## Response Format

All API responses follow this format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

### Error Response

```json
{
  "success": false,
  "data": null,
  "message": "Error description"
}
```

### Validation Error Response

```json
{
  "success": false,
  "errors": [
    {
      "type": "field",
      "msg": "Error message",
      "path": "field_name",
      "location": "body"
    }
  ]
}
```

---

## Headers

### Required Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <JWT_TOKEN>` (for protected routes) |
| `X-Organization-ID` | Organization ID (optional, can be determined from hostname) |

---

## User Roles

- `parent` - Parent/Guardian access
- `animation` - Animator access
- `admin` - Administrator access (full permissions)
