# Audit Log Implementation Requirements

**Status**: Not Implemented (Backend + Frontend required)
**Priority**: P1 (High Priority)
**Issue Type**: Feature Gap (not a mobile/SPA parity issue)

---

## Executive Summary

The audit log feature is **completely missing from the backend**. Both SPA and Mobile attempt to display audit logs for role changes, but the backend API endpoint and database table don't exist. This document outlines the complete implementation requirements.

---

## Current State

### Frontend (SPA)
- **File**: `spa/district_management.js`
- **Function**: `loadAuditLog()` (lines 881-910)
- **API Call**: `GET /api/v1/audit/roles`
- **Parameters**:
  - `user_id`: UUID of the user
  - `limit`: Number of entries (default 15)
  - `organization_id`: Organization context
- **UI Components**:
  - `renderAuditPanel()` (lines 672-702)
  - `renderAuditEntry()` (lines 704-723)
  - Displays actor name, action summary, timestamp, status badges
- **Status**: **Frontend ready, API missing**

### Frontend (Mobile)
- **Status**: **Not implemented** (needs UI after backend is ready)
- **Target Screen**: `AdminScreen.js` (user approval workflow)
- **Expected Feature**: Display role change history for each user

### Backend
- **API Endpoint**: `/api/v1/audit/roles` **DOES NOT EXIST**
- **Database Table**: **DOES NOT EXIST**
- **Status**: **Requires full implementation**

---

## Required Implementation

### 1. Database Schema

Create a new migration with the following table:

```sql
-- Migration: YYYYMMDD_create_role_audit_log.sql

CREATE TABLE IF NOT EXISTS public.role_audit_log (
  id SERIAL PRIMARY KEY,

  -- Who made the change
  actor_id UUID NOT NULL REFERENCES public.users(id),
  actor_name VARCHAR(255), -- Cached for display
  actor_email VARCHAR(255), -- Cached for display

  -- Who was affected
  target_user_id UUID NOT NULL REFERENCES public.users(id),
  target_user_name VARCHAR(255), -- Cached for display
  target_user_email VARCHAR(255), -- Cached for display

  -- What changed
  action VARCHAR(50) NOT NULL, -- 'role_assigned', 'role_removed', 'role_updated'
  roles_before JSONB DEFAULT '[]'::JSONB, -- Array of role IDs before change
  roles_after JSONB DEFAULT '[]'::JSONB, -- Array of role IDs after change
  roles_added JSONB DEFAULT '[]'::JSONB, -- Array of role names added
  roles_removed JSONB DEFAULT '[]'::JSONB, -- Array of role names removed

  -- Context
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id),
  audit_note TEXT, -- Optional note from the actor
  summary TEXT, -- Human-readable summary (e.g., "Added Leader, Finance")

  -- Metadata
  status VARCHAR(20) DEFAULT 'success', -- 'success', 'error', 'pending'
  error_message TEXT,
  ip_address VARCHAR(45), -- IPv4 or IPv6
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Indexes for performance
  CONSTRAINT role_audit_log_target_user_id_idx
    INDEX (target_user_id, organization_id, created_at DESC),
  CONSTRAINT role_audit_log_actor_id_idx
    INDEX (actor_id, organization_id, created_at DESC),
  CONSTRAINT role_audit_log_organization_id_idx
    INDEX (organization_id, created_at DESC)
);

-- Add comments for documentation
COMMENT ON TABLE public.role_audit_log IS 'Audit trail for user role assignments and changes';
COMMENT ON COLUMN public.role_audit_log.summary IS 'Human-readable description like "Added Leader, Finance; Removed Parent"';
COMMENT ON COLUMN public.role_audit_log.audit_note IS 'Optional justification provided by the actor';
```

### 2. Backend API Endpoint

Create `routes/audit.js`:

```javascript
/**
 * Audit Log Routes
 *
 * Provides audit trail for role assignments and other security-sensitive operations
 */

const express = require('express');
const { authenticate, requirePermission, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

module.exports = (pool) => {
  const router = express.Router();

  /**
   * GET /api/v1/audit/roles
   *
   * Fetch role change audit logs for a specific user
   *
   * Query Parameters:
   * - user_id: UUID of the target user (required)
   * - limit: Number of entries to return (default: 15, max: 100)
   * - offset: Pagination offset (default: 0)
   * - organization_id: Organization context (optional, defaults to user's org)
   *
   * Response:
   * {
   *   success: true,
   *   data: [
   *     {
   *       id: 123,
   *       actor_name: "John Doe",
   *       actor_email: "john@example.com",
   *       target_user_name: "Jane Smith",
   *       action: "role_updated",
   *       summary: "Added Leader, Finance",
   *       audit_note: "Approved by district council",
   *       roles_added: ["Leader", "Finance"],
   *       roles_removed: ["Parent"],
   *       status: "success",
   *       created_at: "2024-01-15T14:30:00Z"
   *     }
   *   ],
   *   pagination: {
   *     limit: 15,
   *     offset: 0,
   *     total: 45
   *   }
   * }
   */
  router.get('/v1/audit/roles',
    authenticate,
    requirePermission('users.view'),
    asyncHandler(async (req, res) => {
      const { user_id, limit = 15, offset = 0 } = req.query;

      // Validate user_id
      if (!user_id) {
        return error(res, 'user_id is required', 400);
      }

      // Validate and sanitize limit
      const sanitizedLimit = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 100);
      const sanitizedOffset = Math.max(parseInt(offset, 10) || 0, 0);

      // Get organization context
      const organizationId = await getOrganizationId(req, pool);

      // Verify user belongs to this organization
      const userCheck = await pool.query(
        'SELECT user_id FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [user_id, organizationId]
      );

      if (userCheck.rows.length === 0) {
        return error(res, 'User not found in this organization', 404);
      }

      // Fetch audit logs
      const result = await pool.query(`
        SELECT
          id,
          actor_name,
          actor_email,
          target_user_name,
          target_user_email,
          action,
          roles_added,
          roles_removed,
          audit_note,
          summary,
          status,
          error_message,
          created_at
        FROM role_audit_log
        WHERE target_user_id = $1
          AND organization_id = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
      `, [user_id, organizationId, sanitizedLimit, sanitizedOffset]);

      // Get total count for pagination
      const countResult = await pool.query(
        'SELECT COUNT(*) as total FROM role_audit_log WHERE target_user_id = $1 AND organization_id = $2',
        [user_id, organizationId]
      );

      const total = parseInt(countResult.rows[0]?.total || 0, 10);

      return success(res, {
        audit: result.rows,
        pagination: {
          limit: sanitizedLimit,
          offset: sanitizedOffset,
          total
        }
      });
    })
  );

  /**
   * POST /api/v1/audit/roles
   *
   * Create a role change audit log entry
   *
   * This is typically called automatically by role assignment endpoints,
   * but can also be used manually for recording corrections or notes.
   *
   * Body:
   * {
   *   target_user_id: "uuid",
   *   action: "role_updated",
   *   roles_before: [1, 2],
   *   roles_after: [1, 2, 3],
   *   audit_note: "Optional justification"
   * }
   */
  router.post('/v1/audit/roles',
    authenticate,
    requirePermission('users.assign_roles'),
    asyncHandler(async (req, res) => {
      const { target_user_id, action, roles_before, roles_after, audit_note } = req.body;

      if (!target_user_id || !action) {
        return error(res, 'target_user_id and action are required', 400);
      }

      const organizationId = await getOrganizationId(req, pool);
      const actorId = req.user.id;

      // Get actor details
      const actorResult = await pool.query(
        'SELECT full_name, email FROM users WHERE id = $1',
        [actorId]
      );
      const actor = actorResult.rows[0];

      // Get target user details
      const targetResult = await pool.query(
        'SELECT full_name, email FROM users WHERE id = $1',
        [target_user_id]
      );
      const targetUser = targetResult.rows[0];

      if (!targetUser) {
        return error(res, 'Target user not found', 404);
      }

      // Calculate role changes and build summary
      const beforeSet = new Set(roles_before || []);
      const afterSet = new Set(roles_after || []);
      const added = Array.from(afterSet).filter(id => !beforeSet.has(id));
      const removed = Array.from(beforeSet).filter(id => !afterSet.has(id));

      // Get role names
      const roleNames = await getRoleNames(pool, [...added, ...removed]);
      const addedNames = added.map(id => roleNames[id]).filter(Boolean);
      const removedNames = removed.map(id => roleNames[id]).filter(Boolean);

      // Build summary
      let summary = '';
      if (addedNames.length > 0) {
        summary += `Added ${addedNames.join(', ')}`;
      }
      if (removedNames.length > 0) {
        if (summary) summary += '; ';
        summary += `Removed ${removedNames.join(', ')}`;
      }
      if (!summary) {
        summary = 'No role changes';
      }

      // Insert audit log
      const insertResult = await pool.query(`
        INSERT INTO role_audit_log (
          actor_id, actor_name, actor_email,
          target_user_id, target_user_name, target_user_email,
          action, roles_before, roles_after,
          roles_added, roles_removed,
          organization_id, audit_note, summary,
          status, ip_address, user_agent
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
        ) RETURNING id, created_at
      `, [
        actorId, actor.full_name, actor.email,
        target_user_id, targetUser.full_name, targetUser.email,
        action,
        JSON.stringify(roles_before || []),
        JSON.stringify(roles_after || []),
        JSON.stringify(addedNames),
        JSON.stringify(removedNames),
        organizationId, audit_note, summary,
        'success',
        req.ip,
        req.get('user-agent')
      ]);

      return success(res, insertResult.rows[0], 'Audit log entry created', 201);
    })
  );

  return router;
};

/**
 * Helper function to get role names by IDs
 */
async function getRoleNames(pool, roleIds) {
  if (!roleIds || roleIds.length === 0) return {};

  const result = await pool.query(
    'SELECT id, display_name, role_name FROM roles WHERE id = ANY($1)',
    [roleIds]
  );

  const names = {};
  result.rows.forEach(role => {
    names[role.id] = role.display_name || role.role_name;
  });

  return names;
}
```

### 3. Register Route in api.js

Add to `api.js`:

```javascript
// Audit routes
const auditRoutes = require('./routes/audit');
app.use('/api', auditRoutes(pool));
```

### 4. Integrate with Role Assignment Endpoint

Update `routes/roles.js` (or wherever role assignments are handled) to automatically create audit log entries:

```javascript
const { createAuditLogEntry } = require('./audit'); // Helper function

// After successfully updating user roles:
await createAuditLogEntry(pool, {
  actor_id: req.user.id,
  target_user_id: userId,
  action: 'role_updated',
  roles_before: currentRoleIds,
  roles_after: newRoleIds,
  audit_note: req.body.audit_note,
  organization_id: organizationId,
  ip_address: req.ip,
  user_agent: req.get('user-agent')
});
```

### 5. Mobile Implementation

Once backend is complete, add to `mobile/src/screens/AdminScreen.js`:

```javascript
// Add state
const [auditLogs, setAuditLogs] = useState({});

// Add API call
const loadAuditLog = async (userId) => {
  try {
    const response = await API.get('v1/audit/roles', {
      user_id: userId,
      limit: 15
    });

    if (response.success) {
      setAuditLogs({
        ...auditLogs,
        [userId]: response.audit || []
      });
    }
  } catch (error) {
    debugError('Failed to load audit log:', error);
  }
};

// Add UI component (expandable section in user detail view)
const renderAuditLog = (userId) => {
  const logs = auditLogs[userId] || [];

  if (logs.length === 0) {
    return <Text style={styles.emptyText}>{t('no_audit_history')}</Text>;
  }

  return logs.map((entry) => (
    <View key={entry.id} style={styles.auditEntry}>
      <Text style={styles.auditActor}>{entry.actor_name}</Text>
      <Text style={styles.auditSummary}>{entry.summary}</Text>
      <Text style={styles.auditTime}>
        {formatDate(entry.created_at)}
      </Text>
    </View>
  ));
};
```

---

## Testing Checklist

### Backend Tests
- [ ] Create audit log entry when roles are assigned
- [ ] Create audit log entry when roles are removed
- [ ] Create audit log entry when roles are updated
- [ ] Query returns entries for specific user
- [ ] Query filters by organization correctly
- [ ] Pagination works correctly (limit, offset)
- [ ] Permission checks prevent unauthorized access
- [ ] Summary field is generated correctly
- [ ] IP address and user agent are captured

### Frontend Tests (SPA)
- [ ] Audit log panel displays in district management modal
- [ ] Loading state shown while fetching
- [ ] Entries display actor name, summary, timestamp
- [ ] Error states handled gracefully
- [ ] "No history" message shown when empty

### Frontend Tests (Mobile)
- [ ] Audit log displays in user detail view
- [ ] Expandable section works correctly
- [ ] Formatting matches SPA design patterns
- [ ] Pull-to-refresh updates audit log

---

## Estimated Effort

- **Database Migration**: 30 minutes
- **Backend API Implementation**: 3-4 hours
  - Create routes/audit.js
  - Add helper functions
  - Integrate with role assignment endpoints
  - Add tests
- **Mobile UI Implementation**: 2-3 hours
  - Add API calls
  - Create UI components
  - Add to AdminScreen
  - Test on device
- **Testing & QA**: 2 hours
- **Documentation**: 1 hour

**Total**: ~8-10 hours

---

## Security Considerations

1. **Audit Log Integrity**: Audit logs should never be deleted, only marked as reviewed
2. **Permission Checks**: Only users with `users.view` permission can read audit logs
3. **Data Retention**: Consider implementing a retention policy (e.g., keep 2 years)
4. **PII Handling**: Actor and target names/emails are cached for display even if users are deleted
5. **Tamper Protection**: Consider adding a hash/signature field for tamper detection

---

## Future Enhancements (Not P1)

- [ ] Export audit logs to CSV
- [ ] Advanced filtering (by date range, actor, action type)
- [ ] Audit log retention policy (archive old entries)
- [ ] Webhook notifications for high-risk role changes
- [ ] Audit log for other entities (participants, finances, etc.)
- [ ] Tamper detection with cryptographic hashing
- [ ] Compliance reporting (GDPR, SOC2)

---

## References

- SPA Implementation: `spa/district_management.js` (lines 881-910, 672-723)
- Frontend API Call: `spa/api/api-endpoints.js` (lines 607-624)
- Database Schema: `attached_assets/Full_Database_schema.sql`
- User-Role Relationship: `user_organizations` table (role_ids JSONB column)
