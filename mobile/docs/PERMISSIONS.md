# Wampums Permissions Reference

**Last Updated:** December 27, 2025

This document lists all available permissions in the Wampums Scout Management System. These permissions are used for role-based access control throughout the application.

---

## Permission Categories

### Organization Management
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 1 | `org.create` | Create Organizations | Create new organizations in the system |
| 2 | `org.view` | View Organization | View organization details |
| 3 | `org.edit` | Edit Organization | Edit organization settings |
| 4 | `org.delete` | Delete Organization | Delete organizations |

### User Management
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 5 | `users.view` | View Users | View user lists and details |
| 6 | `users.invite` | Invite Users | Invite new users to the organization |
| 7 | `users.edit` | Edit Users | Edit user information and settings |
| 8 | `users.delete` | Delete Users | Remove users from the organization |
| 9 | `users.assign_roles` | Assign Roles | Assign roles to users |
| 10 | `users.assign_district` | Assign District Role | Assign district administrator role to users |

### Participant Management
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 11 | `participants.view` | View Participants | View participant lists and details |
| 12 | `participants.create` | Create Participants | Add new participants |
| 13 | `participants.edit` | Edit Participants | Edit participant information |
| 14 | `participants.delete` | Delete Participants | Remove participants |
| 15 | `participants.transfer` | Transfer Participants | Transfer participants between groups |
| 84 | `guardians.view` | View Guardians | View guardian/parent information |
| 85 | `guardians.edit` | Edit Guardians | Edit guardian/parent information |
| 86 | `guardians.manage` | Manage Guardians | Full guardian management access |

### Financial Management
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 16 | `finance.view` | View Finances | View financial information and reports |
| 17 | `finance.manage` | Manage Finances | Manage financial transactions and settings |
| 18 | `finance.approve` | Approve Payments | Approve and process payments |
| 19 | `budget.view` | View Budget | View budget information |
| 20 | `budget.manage` | Manage Budget | Create and edit budgets |
| 82 | `calendar.view` | View Payment Calendar | View payment calendars and schedules |
| 83 | `calendar.manage` | Manage Payment Calendar | Manage payment calendars and schedules |

### Fundraisers
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 21 | `fundraisers.view` | View Fundraisers | View fundraiser information |
| 22 | `fundraisers.create` | Create Fundraisers | Create new fundraisers |
| 23 | `fundraisers.edit` | Edit Fundraisers | Edit fundraiser details |
| 24 | `fundraisers.delete` | Delete Fundraisers | Remove fundraisers |

### Inventory Management
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 25 | `inventory.view` | View Inventory | View equipment and inventory |
| 26 | `inventory.manage` | Manage Inventory | Add, edit, and remove inventory items |
| 27 | `inventory.reserve` | Reserve Equipment | Reserve equipment for activities |
| 28 | `inventory.value` | View Inventory Values | View monetary values of inventory |

### Badge Management
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 29 | `badges.view` | View Badges | View badge information and progress |
| 30 | `badges.approve` | Approve Badges | Approve badge completions |
| 31 | `badges.manage` | Manage Badges | Create and configure badges |

### Activities
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 32 | `activities.view` | View Activities | View activities and events |
| 33 | `activities.create` | Create Activities | Create new activities |
| 34 | `activities.edit` | Edit Activities | Edit activity details |
| 35 | `activities.delete` | Delete Activities | Remove activities |

### Attendance
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 36 | `attendance.view` | View Attendance | View attendance records |
| 37 | `attendance.manage` | Manage Attendance | Record and edit attendance |

### Points & Honors
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 38 | `points.view` | View Points | View points and honors |
| 39 | `points.manage` | Manage Points | Award and manage points |
| 57 | `honors.view` | View Honors | View honors and awards history |
| 58 | `honors.create` | Award Honors | Award honors to participants |
| 59 | `honors.manage` | Manage Honors | Manage honor types and settings |

### Carpools
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 40 | `carpools.view` | View Carpools | View carpool information |
| 41 | `carpools.manage` | Manage Carpools | Create and manage carpool arrangements |

### Reports
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 42 | `reports.view` | View Reports | Access all system reports |
| 43 | `reports.export` | Export Reports | Export reports to various formats |

### Groups
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 44 | `groups.view` | View Groups | View group information |
| 45 | `groups.create` | Create Groups | Create new groups |
| 46 | `groups.edit` | Edit Groups | Edit group details |
| 47 | `groups.delete` | Delete Groups | Remove groups |

### Communications
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 48 | `communications.send` | Send Communications | Send messages to parents and participants |
| 80 | `notifications.manage` | Manage Notifications | Manage push notification subscriptions |
| 81 | `notifications.send` | Send Notifications | Send push notifications to users |

### Roles
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 49 | `roles.view` | View Roles | View available roles and permissions |
| 50 | `roles.manage` | Manage Roles | Create and edit custom roles |

### Forms
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 51 | `forms.view` | View Forms | View form submissions and structures |
| 52 | `forms.submit` | Submit Forms | Submit forms for participants |
| 53 | `forms.manage` | Manage Forms | Manage form formats and templates |
| 54 | `forms.create` | Create Forms | Create new form templates |
| 55 | `forms.edit` | Edit Forms | Edit form templates and formats |
| 56 | `forms.delete` | Delete Forms | Delete form templates |

### Meetings
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 60 | `meetings.view` | View Meetings | View meeting preparations and invites |
| 61 | `meetings.create` | Create Meetings | Create meeting preparations |
| 62 | `meetings.edit` | Edit Meetings | Edit meeting preparations |
| 63 | `meetings.delete` | Delete Meetings | Delete meeting preparations |
| 64 | `meetings.manage` | Manage Meetings | Full meeting management access |

### **Medication Management** 💊
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 65 | `medication.view` | View Medication | View medication requirements and distributions |
| 66 | `medication.manage` | Manage Medication | Manage medication requirements and distributions |
| 67 | `medication.distribute` | Distribute Medication | Record medication distributions |

**Usage:**
- **Planning medication requirements**: Requires `medication.manage`
- **Viewing medication schedules**: Requires `medication.view`
- **Recording distributions**: Requires `medication.distribute` or `medication.manage`

### Announcements
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 68 | `announcements.view` | View Announcements | View announcements |
| 69 | `announcements.create` | Create Announcements | Create new announcements |
| 70 | `announcements.edit` | Edit Announcements | Edit announcements |
| 71 | `announcements.delete` | Delete Announcements | Delete announcements |
| 72 | `announcements.manage` | Manage Announcements | Full announcement management access |

### Resources
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 73 | `resources.view` | View Resources | View shared resources and files |
| 74 | `resources.create` | Create Resources | Upload new resources |
| 75 | `resources.edit` | Edit Resources | Edit resource information |
| 76 | `resources.delete` | Delete Resources | Delete resources |
| 77 | `resources.manage` | Manage Resources | Full resource management access |

### Data Management
| ID | Permission Key | Name | Description |
|----|---------------|------|-------------|
| 78 | `data.import` | Import Data | Import external data into the system |
| 79 | `data.export` | Export Data | Export system data |

---

## Usage in Code

### Frontend (React Native)

```javascript
import { hasPermission, hasAnyPermission } from '../utils/PermissionUtils';

// Check single permission
if (hasPermission('medication.manage', userPermissions)) {
  // Show medication planning button
}

// Check any of multiple permissions
if (hasAnyPermission(['medication.manage', 'medication.distribute'], userPermissions)) {
  // Show medication distribution interface
}
```

### Backend (Node.js)

```javascript
const { authorize } = require('../middleware/auth');

// Require specific permission
router.post('/medication-requirements',
  authenticate,
  authorize('medication.manage'),
  handler
);

// Allow multiple permissions
router.get('/medication-distributions',
  authenticate,
  authorize('medication.view', 'medication.manage', 'medication.distribute'),
  handler
);
```

---

## Permission Hierarchy

Some permissions imply others:

- **`.manage` permissions** typically include view, create, edit, and delete capabilities
- **`.edit` permissions** typically require `.view`
- **`.delete` permissions** typically require `.view` and `.edit`

### Examples:

- `medication.manage` → Can view, plan, and distribute medications
- `medication.distribute` → Can record distributions (subset of manage)
- `medication.view` → Can only view medication schedules (read-only)

---

## Common Permission Combinations

### Leader/Staff Role (Animation)
Typical permissions for a scout leader:
- `participants.view`, `participants.edit`
- `attendance.manage`
- `points.manage`
- `badges.view`, `badges.approve`
- `activities.view`, `activities.create`
- `meetings.manage`
- `medication.distribute`
- `groups.view`

### Administrator Role
Full access to organization:
- All permissions in the organization category
- `users.assign_roles`
- `finance.manage`
- `inventory.manage`
- `medication.manage`
- `reports.view`, `reports.export`

### Parent Role
Limited access:
- `participants.view` (own children only)
- `activities.view`
- `finance.view` (own payments only)
- `carpools.view`, `carpools.manage` (own carpools)
- `forms.submit`
- `medication.view` (own children only)

---

## Notes

- Permissions are checked on **both frontend and backend** for security
- Frontend permission checks hide/show UI elements
- Backend permission checks enforce actual access control
- Always use backend authorization - never rely solely on frontend checks
- Permissions are case-sensitive (use lowercase with dot notation)
- Permission keys follow the pattern: `category.action`

---

## Related Documentation

- See `/middleware/auth.js` for backend authorization implementation
- See `/mobile/src/utils/PermissionUtils.js` for frontend permission utilities
- See database table `permissions` for the source of truth
- See database table `role_permissions` for role-to-permission mappings
