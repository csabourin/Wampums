# Custom Forms Enhancement - Version Tracking & Audit Trail

## Overview

This migration adds comprehensive version tracking and audit trail capabilities to the Wampums custom forms system.

## What's New

### 1. **Form Version Tracking**
- Every form format now has versions
- Track who created each version and when
- Know which version was used for each submission
- Rollback capability by activating previous versions

### 2. **Audit Trail**
- Automatic history tracking for all form submission changes
- Record who edited what and when
- Track IP addresses and user agents for compliance
- Store change summaries for quick review

### 3. **Workflow Management**
- Draft submissions (save without submitting)
- Submitted, reviewed, approved, rejected statuses
- Review notes and reviewer tracking
- Submission timestamps

### 4. **Enhanced Metadata**
- Display names for forms
- Descriptions and instructions
- Categories and tags
- Validity periods
- Publication status (draft/published/archived)

## Database Changes

### New Tables
- `form_format_versions` - Stores all versions of form formats
- `form_submission_history` - Complete audit trail of all changes
- `form_permissions` - Role-based access control for forms

### Enhanced Tables
- `organization_form_formats` - Added status, display_name, validity periods, etc.
- `form_submissions` - Added status, version tracking, audit fields

### Helper Functions
- `create_new_form_version()` - Creates a new version
- `publish_form_version()` - Makes a version active
- Automatic audit trail trigger

### Views
- `v_active_forms` - Published forms with their current version
- `v_form_submission_stats` - Submission statistics by form type

## How to Use

### Running the Migration

```bash
# Option 1: Run directly with psql
psql -U your_username -d wampums_db -f migrations/20251223_enhance_custom_forms_versioning.sql

# Option 2: Or copy the SQL and run in your database tool
```

### API Endpoints

#### Version Management (Admin Only)

**Create New Version**
```http
POST /api/form-formats/{id}/versions
Content-Type: application/json
Authorization: Bearer {token}

{
  "form_structure": {
    "fields": [...]
  },
  "display_name": "Health Form v2",
  "change_description": "Added allergy severity field"
}
```

**Publish a Version**
```http
POST /api/form-versions/{versionId}/publish
Authorization: Bearer {token}
```

**Get All Versions**
```http
GET /api/form-formats/{id}/versions
Authorization: Bearer {token}
```

**Archive a Form**
```http
POST /api/form-formats/{id}/archive
Authorization: Bearer {token}
```

#### Submission Management

**Save with Status**
```http
POST /api/save-form-submission
Content-Type: application/json
Authorization: Bearer {token}

{
  "participant_id": 123,
  "form_type": "health_form",
  "submission_data": {...},
  "status": "draft"  // or "submitted"
}
```

**Update Submission Status**
```http
PUT /api/form-submission-status
Content-Type: application/json
Authorization: Bearer {token}

{
  "submission_id": 456,
  "status": "approved",
  "review_notes": "All information verified"
}
```

**Get Audit Trail**
```http
GET /api/form-submission-history/{submissionId}
Authorization: Bearer {token}
```

**Get Form Version History**
```http
GET /api/form-versions/{formType}
Authorization: Bearer {token}
```

## Frontend Integration

### Cache Invalidation

After successful form operations, invalidate caches:

```javascript
import { clearFormRelatedCaches, clearParticipantFormCaches } from './indexedDB.js';

// After creating/updating a form format
await clearFormRelatedCaches(formType);

// After saving a participant's submission
await clearParticipantFormCaches(participantId, formType);
```

### Example: Save Form with Cache Invalidation

```javascript
import { saveFormSubmission } from './ajax-functions.js';
import { clearParticipantFormCaches } from './indexedDB.js';

async function saveForm(participantId, formType, data) {
  try {
    const result = await saveFormSubmission(formType, participantId, data);

    if (result.success) {
      // Invalidate caches based on server hint
      if (result.cache?.invalidate) {
        await clearParticipantFormCaches(participantId, formType);
        await clearFormRelatedCaches(formType);
      }

      return result;
    }
  } catch (error) {
    console.error('Error saving form:', error);
    throw error;
  }
}
```

## Workflow Examples

### Example 1: Creating a New Form Version

1. Admin edits an existing form
2. Instead of updating, they create a new version:
   ```javascript
   POST /api/form-formats/5/versions
   {
     "form_structure": { ... new structure ... },
     "change_description": "Added emergency contact field"
   }
   ```
3. This creates version 2 (inactive)
4. Admin reviews and publishes:
   ```javascript
   POST /api/form-versions/12/publish
   ```
5. All new submissions now use version 2
6. Old submissions remain linked to version 1

### Example 2: Submission Approval Workflow

1. Parent fills out form, saves as draft:
   ```javascript
   POST /api/save-form-submission
   { "status": "draft", ... }
   ```
2. Parent reviews and submits:
   ```javascript
   POST /api/save-form-submission
   { "status": "submitted", ... }
   ```
3. Admin reviews submission:
   ```javascript
   PUT /api/form-submission-status
   {
     "submission_id": 789,
     "status": "reviewed"
   }
   ```
4. Admin approves:
   ```javascript
   PUT /api/form-submission-status
   {
     "submission_id": 789,
     "status": "approved",
     "review_notes": "Verified with school records"
   }
   ```
5. View complete history:
   ```javascript
   GET /api/form-submission-history/789
   ```

## Benefits

### For Administrators
- **Compliance**: Complete audit trail for regulatory requirements
- **Flexibility**: Update forms without breaking old submissions
- **Control**: Approve/reject submissions with notes
- **Visibility**: See who changed what and when

### For Developers
- **Data Integrity**: Never lose historical data
- **Versioning**: Safe form updates without data migration
- **Debugging**: Trace issues through audit trail
- **Caching**: Automatic cache invalidation hints

### For Users
- **Save Drafts**: Don't lose work if interrupted
- **Transparency**: See review status and notes
- **Consistency**: Forms don't change unexpectedly

## Best Practices

### 1. Version Management
- Create new versions for significant changes
- Use descriptive `change_description`
- Test versions before publishing
- Archive old forms instead of deleting

### 2. Submission Workflow
- Save as "draft" for partial completion
- Change to "submitted" when ready for review
- Always add review_notes when approving/rejecting

### 3. Cache Management
- Clear caches after form structure changes
- Clear participant caches after submission updates
- Use the cache hints from API responses

### 4. Audit Trail
- Regularly review submission history for sensitive forms
- Use IP and user agent data for security investigations
- Export audit logs for compliance reporting

## Rollback Procedure

If a form version has issues:

```sql
-- Find the previous version
SELECT id, version_number, is_active
FROM form_format_versions
WHERE form_format_id = 5
ORDER BY version_number DESC;

-- Publish the previous version (e.g., version 2)
SELECT publish_form_version(10);  -- version_id of v2
```

## Monitoring

### Check Active Versions
```sql
SELECT * FROM v_active_forms WHERE organization_id = 1;
```

### Submission Statistics
```sql
SELECT * FROM v_form_submission_stats WHERE organization_id = 1;
```

### Recent Changes
```sql
SELECT
  fsh.form_submission_id,
  fsh.edited_at,
  fsh.status,
  u.full_name as editor
FROM form_submission_history fsh
JOIN users u ON fsh.edited_by = u.id
WHERE fsh.edited_at > NOW() - INTERVAL '24 hours'
ORDER BY fsh.edited_at DESC;
```

## Troubleshooting

### Issue: Submissions not linking to versions
**Solution**: The migration automatically creates version 1 for all existing forms. If a new form doesn't have a version, check that it was created properly through the API.

### Issue: Cache not clearing
**Solution**: Ensure the frontend is calling the cache invalidation functions after successful API calls. Check the `result.cache.invalidate` hint in API responses.

### Issue: Audit trail not recording
**Solution**: The trigger should create history automatically. Check that the trigger exists:
```sql
SELECT * FROM pg_trigger WHERE tgname = 'form_submission_audit_trigger';
```

## Future Enhancements

Potential additions for the future:
- Form templates for reuse across organizations
- Conditional logic builder UI
- File attachments for submissions
- Analytics dashboard
- Scheduled form validity (auto-archive expired forms)
- Email notifications on status changes
- Bulk approval/rejection

## Support

For issues or questions:
1. Check this README
2. Review the migration SQL comments
3. Check API documentation (Swagger/OpenAPI)
4. Check application logs

---

**Migration Date**: 2025-12-23
**Version**: 1.0
**Requires**: PostgreSQL 12+
