# Role & Permission System Refactoring

**Date**: 2025-12-22
**Purpose**: Clean up legacy role architecture and implement role-centric management UI

## 🎯 Overview

This refactoring removes legacy single-role columns and fully transitions the system to use the RBAC (Role-Based Access Control) architecture where:
- **Permissions** are linked to **Roles** (not users)
- **Users** are linked to **Roles** (not directly to permissions)
- Users can have **multiple roles** simultaneously

## 📊 Database Changes

### Removed Columns
1. `user_organizations.role` (VARCHAR) - Legacy single-role field
2. `users.role` (TEXT) - Legacy single-role field
3. `user_organizations_backup.role` - Backup table column

### Updated Views
- `user_role_permissions_summary` - Now derives all data from `role_ids` JSONB field only

### Migration File
- **File**: `migrations/010_remove_legacy_role_columns.sql`
- **Idempotent**: Yes - can be run multiple times safely
- **Run with**: `bash run-role-migration.sh`

## 🔧 Backend Changes

### Updated Files

#### `routes/users.js`
- Removed `uo.role` from SELECT statements
- Updated role filtering to use `role_ids` JSONB and join with `roles` table
- Changed role checks from `uo.role IN (...)` to `r.role_name IN (...)`

#### `routes/announcements.js`
- Updated recipient filtering to use `role_ids` instead of `role`
- Added DISTINCT to queries to handle multi-role scenarios
- Updated subscriber queries for role-based filtering

#### `utils/index.js`
- Updated admin email fetching to use new role system
- Changed permission checking to support multiple roles per user
- Updated `hasPermission()` to check if user has ANY of the allowed roles

#### `api.js`
- Updated `verifyOrganizationMembership()` to return `roles` array
- Updated mailing list generation to use new role system
- Changed animateurs query to include all leader roles

## 🎨 Frontend Changes

### Completely Refactored: `spa/role_management.js`

**Before**: User-centric interface
- Selected users to assign roles
- Fetched ALL permissions upfront (data-heavy)
- Single-view layout

**After**: Role-centric interface with two tabs

#### Tab 1: Roles & Permissions
- View all available roles
- Expand to see permissions for each role
- Lazy-loading of permissions (only when expanded)
- Card-based layout with clear role descriptions

#### Tab 2: Assign Roles to Users
- Search and filter users
- Select user to manage their roles
- Checkbox interface for multi-role assignment
- Shows current roles with badges
- Real-time role assignment

### Key Improvements
1. **Reduced data fetching**: Only loads what's needed, when needed
2. **Better UX**: Clear separation between viewing roles and assigning them
3. **Cache invalidation**: Properly clears caches after role updates following CLAUDE.md guidelines
4. **Multi-role support**: Native support for users with multiple roles

### Other Frontend Files
No changes needed - frontend already uses:
- `app.userRole` - Primary role (for backward compatibility)
- `app.userRoles` - Array of all roles
- `app.userPermissions` - Array of all permissions (derived from roles)

## 🔄 Data Flow

### Before (Legacy)
```
user_organizations.role (single VARCHAR) → Hardcoded permission checks
users.role (single TEXT) → Limited flexibility
```

### After (Refactored)
```
Roles Table → Permissions Table (via role_permissions junction)
     ↓
user_organizations.role_ids (JSONB array)
     ↓
User has multiple roles
     ↓
User has all permissions from all their roles
```

## ✅ Testing Checklist

After deploying:

- [ ] Run migration: `bash run-role-migration.sh`
- [ ] Verify legacy columns are removed
- [ ] Test role management UI:
  - [ ] Can view roles and their permissions (Tab 1)
  - [ ] Can assign roles to users (Tab 2)
  - [ ] Multi-role assignment works
  - [ ] Role badges display correctly
- [ ] Test permission checks still work:
  - [ ] District admin has full access
  - [ ] Unitadmin has appropriate access
  - [ ] Leaders can access their features
  - [ ] Parents have limited access
- [ ] Test announcements still send to correct role groups
- [ ] Verify user sessions still work after role changes
- [ ] Check that caches are properly invalidated after role updates

## 🚀 Deployment Steps

1. **Backup database** (CRITICAL!)
   ```bash
   pg_dump $DATABASE_URL > backup_before_role_refactoring.sql
   ```

2. **Run migration**
   ```bash
   bash run-role-migration.sh
   ```

3. **Restart application** to ensure all caches are cleared

4. **Test core workflows**:
   - Login as different role types
   - Assign roles to users
   - Verify permissions work correctly

5. **Monitor logs** for any errors related to role checks

## 🔒 Backward Compatibility

The system maintains backward compatibility by:
1. Backend APIs return both `role` (primary) and `roles` (array)
2. JWT tokens include `userRole` (primary) and `userRoles` (array)
3. Frontend code uses `app.userRole` for simple checks and `app.userRoles` for comprehensive checks

## 📝 Key Architectural Decisions

1. **Why remove single-role columns?**
   - Eliminates data redundancy
   - Prevents inconsistencies between `role` and `role_ids`
   - Forces proper use of RBAC architecture

2. **Why role-centric UI?**
   - More intuitive for admins to understand permissions
   - Reduces cognitive load (separate concerns)
   - Lazy-loading reduces data transfer

3. **Why keep backward compatibility?**
   - Smooth transition for existing code
   - Gradual migration path
   - Prevents breaking changes in third-party integrations

## 📚 Related Documentation

- **ROLE_SYSTEM_README.md** - Comprehensive role system documentation
- **CLAUDE.md** - Cache invalidation guidelines
- **config/roles.js** - Client-side role bundle definitions

## 🐛 Known Issues

None at this time.

## 👥 Support

For questions or issues:
1. Check ROLE_SYSTEM_README.md
2. Review migration SQL file comments
3. Test with demo users before applying to production accounts

---

**Migration Created**: 2025-12-22
**Author**: Claude AI
**Status**: Ready for deployment
