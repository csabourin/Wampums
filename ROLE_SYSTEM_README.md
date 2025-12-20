# Role-Based Permission System Implementation

## Version: 2.6.0

This document describes the new role-based permission system implemented in Wampums.

## 🎯 Overview

The application has been upgraded from hardcoded role checks to a flexible, permission-based role system that supports:

- **Multiple roles per user** - Users can have multiple roles in the same organization
- **Granular permissions** - Each role has specific permissions for different features
- **Database-driven roles** - Roles and permissions are stored in the database, not hardcoded
- **Demo roles** - Special read-only roles for demonstration purposes
- **Backward compatibility** - Existing users are automatically migrated to the new system

## 🔑 New Roles

### System Roles (cannot be deleted):

1. **district** (replaces `admin`)
   - Full system access including organization creation
   - Can assign any role including district
   - Can manage all features

2. **unitadmin** (new)
   - Full organizational access except organization creation
   - Cannot assign district role
   - Default admin for an organization

3. **leader** (replaces `animation`)
   - Group leaders with access to most organizational features
   - Can manage participants, activities, attendance, points
   - Can view finance and badges

4. **parent** (unchanged)
   - Limited access to own children's information
   - Can view badges, activities, attendance
   - Can manage carpools for own children

5. **finance** (new)
   - Access to all financial features
   - Budget, fundraisers, inventory values
   - Finance reports

6. **equipment** (new)
   - Manages inventory and equipment only
   - Can add/remove/reserve equipment

7. **administration** (new)
   - Access to all reports and administrative analytics
   - Read-only access to organizational data

8. **demoadmin** (new)
   - Read-only administrator for demonstrations
   - Can see all admin features but cannot modify data

9. **demoparent** (new)
   - Read-only parent for demonstrations
   - Can browse parent dashboard but cannot make changes

## 📋 Key Features

### User Migration

- `animation` users → `leader` role
- `admin` users → `district` role
- `parent` users → `parent` role (unchanged)

### Multiple Roles

Users can have multiple roles simultaneously. Permissions are cumulative:
- A user with both `leader` and `finance` roles has all permissions from both roles

### Permission Categories

Permissions are organized by category:
- **Organization**: `org.create`, `org.view`, `org.edit`, `org.delete`
- **Users**: `users.view`, `users.edit`, `users.delete`, `users.assign_roles`
- **Finance**: `finance.view`, `finance.manage`, `finance.approve`
- **Budget**: `budget.view`, `budget.manage`
- **Inventory**: `inventory.view`, `inventory.manage`, `inventory.reserve`, `inventory.value`
- **Badges**: `badges.view`, `badges.approve`, `badges.manage`
- **Activities**: `activities.view`, `activities.create`, `activities.edit`, `activities.delete`
- **Reports**: `reports.view`, `reports.export`
- And many more...

## 🚀 Running the Migration

### Prerequisites

1. **Backup your database** before running the migration!
2. Ensure PostgreSQL is running and accessible
3. Have your `DATABASE_URL` environment variable set

### Steps to Run Migration

```bash
# 1. Navigate to project directory
cd /home/user/Wampums

# 2. Install dependencies (if not already installed)
npm install

# 3. Run the migration
node run-migration.js migrations/001_create_role_permission_system.sql
```

### What the Migration Does

1. ✅ Creates `roles` table with all system roles
2. ✅ Creates `permissions` table with all permissions
3. ✅ Creates `role_permissions` junction table (many-to-many)
4. ✅ Adds `role_ids` (JSONB) column to `user_organizations` table
5. ✅ Seeds all roles and permissions
6. ✅ Creates role-permission mappings
7. ✅ Migrates existing users to new role system
8. ✅ Creates `user_permissions` view for easy permission checking
9. ✅ Backs up old data to `user_organizations_backup` table

### Verification

After running the migration, verify it worked:

```sql
-- Check roles were created
SELECT * FROM roles ORDER BY id;

-- Check permissions were created
SELECT COUNT(*) FROM permissions;

-- Check a user's roles
SELECT u.email, r.role_name, r.display_name
FROM users u
JOIN user_organizations uo ON u.id = uo.user_id
CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id
JOIN roles r ON r.id = role_id::integer
WHERE u.email = 'your-email@example.com';

-- Check a user's permissions
SELECT permission_key
FROM user_permissions
WHERE user_id = 'YOUR_USER_ID'
AND organization_id = YOUR_ORG_ID
ORDER BY permission_category, permission_key;
```

## 📝 Code Changes

### Backend Changes

#### New Files:
- `migrations/001_create_role_permission_system.sql` - Database migration
- `routes/roles.js` - Role management API endpoints

#### Modified Files:
- `middleware/auth.js` - Added `requirePermission`, `blockDemoRoles` middleware
- `routes/auth.js` - Updated JWT to include roles and permissions
- `api.js` - Registered new role routes

#### New API Endpoints:

**Role Management:**
- `GET /api/roles` - Get all roles (district/unitadmin only)
- `POST /api/roles` - Create custom role (district only)
- `DELETE /api/roles/:roleId` - Delete custom role (district only)
- `GET /api/roles/:roleId/permissions` - Get role permissions
- `POST /api/roles/:roleId/permissions` - Add permission to role
- `DELETE /api/roles/:roleId/permissions/:permissionId` - Remove permission

**Permission Management:**
- `GET /api/permissions` - Get all permissions (district/unitadmin only)

**User Role Assignment:**
- `GET /api/users/:userId/roles` - Get user's roles
- `PUT /api/users/:userId/roles` - Update user's roles (district/unitadmin only)

#### New Middleware:

```javascript
// Permission-based authorization
requirePermission('finance.view')
requirePermission('users.manage', 'users.edit')

// Block demo users from mutations
blockDemoRoles

// Helper functions
hasAnyPermission(req, 'finance.view', 'budget.view')
hasAllPermissions(req, 'users.view', 'users.edit')
hasAnyRole(req, 'district', 'unitadmin')
```

### Frontend Changes

#### New Files:
- `spa/utils/PermissionUtils.js` - Permission checking utilities

#### Modified Files:
- `spa/login.js` - Store roles and permissions in localStorage
- `spa/app.js` - Added userRoles and userPermissions to app state

#### Permission Utilities:

```javascript
import { hasPermission, hasRole, isAdmin, isDemoUser } from './utils/PermissionUtils.js';

// Check permissions
if (hasPermission('finance.view')) {
  // Show financial features
}

// Check roles
if (hasRole('district')) {
  // Show district-only features
}

// Helper functions
isAdmin() // district or unitadmin
isDistrictAdmin() // district only
isParent() // parent or demoparent
isDemoUser() // demoadmin or demoparent
canManageRoles()
canCreateOrganization()
```

## 🔒 Security Features

### Demo Role Protection

Demo users (`demoadmin`, `demoparent`) are blocked from:
- POST, PUT, PATCH, DELETE requests (API level)
- All mutations return: `"This feature is not available in demo mode"`

### Role Assignment Restrictions

- Only district admins can assign the district role
- Unitadmins cannot see or assign district role
- All role assignments are logged

### Backward Compatibility

- Old `user_organizations.role` column is kept temporarily
- Primary role (`user_role`) is maintained in JWT for compatibility
- Existing code using `app.userRole` continues to work

## 📊 Database Schema

### New Tables:

```sql
-- Roles table
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permissions table
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    permission_key VARCHAR(100) UNIQUE NOT NULL,
    permission_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Role-Permission junction table
CREATE TABLE role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
```

### Modified Tables:

```sql
-- user_organizations: Added role_ids column
ALTER TABLE user_organizations
ADD COLUMN role_ids JSONB DEFAULT '[]'::jsonb;

-- Old 'role' column is kept for now but will be deprecated
```

## 🎯 Next Steps

### For District Admins:

1. **Review User Roles**: After migration, check that all users have the correct roles
2. **Assign Additional Roles**: Some users may need multiple roles (e.g., leader + finance)
3. **Create Demo Users**: Set up demo accounts for testing

### For Developers:

1. **Update Route Protection**: Replace old role checks with permission-based middleware
2. **Update Frontend UI**: Use PermissionUtils to show/hide features
3. **Create Role Management UI**: Build interface for district/unitadmin to manage roles
4. **Test Each Role**: Verify each role has appropriate access

### Future Enhancements:

- [ ] Build role management UI page
- [ ] Update all route protections to use permission middleware
- [ ] Update dashboard to show/hide features based on permissions
- [ ] Add organization creation button (district only)
- [ ] Create audit log for role changes
- [ ] Add role templates/presets
- [ ] Custom role creation for advanced users

## 🐛 Troubleshooting

### Migration Fails

**Error**: `column "role_ids" already exists`
- The migration may have partially run. Check database state before re-running.

**Error**: `relation "roles" already exists`
- Tables already created. Check if migration completed successfully.

### Users Can't Login

**Issue**: Login works but users have no permissions
- Check that role_ids column is populated: `SELECT user_id, role_ids FROM user_organizations;`
- Verify JWT includes permissions: Decode token and check `permissions` field

### Missing Permissions

**Issue**: User should have permission but doesn't
- Check user's roles: `SELECT * FROM user_permissions WHERE user_id = 'xxx';`
- Verify role-permission mapping: `SELECT * FROM role_permissions WHERE role_id = X;`
- Check if permission exists: `SELECT * FROM permissions WHERE permission_key = 'xxx';`
- Use the summary view to audit assignments: `SELECT * FROM user_role_permissions_summary WHERE organization_id = 1 ORDER BY full_name;`

### User Role & Permission View

Use the `user_role_permissions_summary` view to quickly review account access:

- **Columns**: `organization_id`, `user_id`, `full_name`, `roles` (text[]), `permissions` (text[])
- **Includes** legacy `user_organizations.role` plus new `role_ids` entries
- **Aggregation** deduplicates role and permission keys for each organization/user pairing
- **Example**: `SELECT full_name, roles, permissions FROM user_role_permissions_summary WHERE user_id = 42;`

## 📞 Support

For questions or issues with the role system:
1. Check this README first
2. Review the migration SQL file for details
3. Consult the CLAUDE.md file for development guidelines

## ✅ Testing Checklist

After migration, test each role:

- [ ] **District Admin**: Can access all features, create orgs, assign district role
- [ ] **Unit Admin**: Can access all features except org creation and district assignment
- [ ] **Leader**: Can manage participants, activities, attendance
- [ ] **Parent**: Can only see own children's data
- [ ] **Finance**: Can access budget, fundraisers, inventory values
- [ ] **Equipment**: Can only manage inventory
- [ ] **Administration**: Can view all reports
- [ ] **Demo Admin**: Can see everything but cannot modify
- [ ] **Demo Parent**: Can see parent dashboard but cannot modify

---

**Migration Created**: 2025-12-19
**Version**: 2.6.0
**Author**: Claude AI
