# Activity Creation Fix

## Problem
Users were unable to create activities through the Quick Create Activity modal, receiving a 400 Bad Request error with the message:
```
Missing required fields: name, activity_start_date, activity_start_time, activity_end_date, activity_end_time, meeting_location_going, meeting_time_going, departure_time_going
```

This error occurred even when all required fields were properly filled in the form.

## Root Cause
The issue was caused by two main problems:

### 1. Empty Optional Fields as Empty Strings
When form fields for optional return trip information (meeting_location_return, meeting_time_return, departure_time_return) were left empty, they were still sent to the backend as empty strings `""` rather than being omitted or sent as `null`. While the backend normalization logic should handle empty strings correctly (since `"" || fallback` evaluates to `fallback`), having explicit `null` values is clearer and more consistent with how the main activities page handles this.

### 2. Generic Error Messages
The backend validation error message was generic and always listed ALL possible required fields, even if only one field was actually missing. This made it very difficult to diagnose which specific field was causing the validation to fail.

## Solution

### Frontend Changes (spa/modules/modals/QuickCreateActivityModal.js)

1. **Added cleanFormData utility function**
   ```javascript
   function cleanFormData(data, optionalFields = []) {
     const cleaned = { ...data };
     optionalFields.forEach(field => {
       if (cleaned[field] === '' || cleaned[field] === null || cleaned[field] === undefined) {
         cleaned[field] = null;
       }
     });
     return cleaned;
   }
   ```

2. **Applied cleaning to optional fields**
   - description
   - meeting_location_return
   - meeting_time_return
   - departure_time_return

3. **Added safeguard for empty form data**
   - Check if form data is completely empty and show helpful error message
   - Prevents mysterious failures if form isn't properly initialized

### Backend Changes (routes/activities.js)

1. **Improved validation error messages**
   - Changed from generic "Missing required fields: [all fields]"
   - To specific "Missing required fields: [only the actual missing fields]"
   - Shows field alternatives (e.g., "activity_start_date or activity_date")

2. **Added debug logging**
   - Logs request body for troubleshooting
   - Logs Content-Type header
   - Logs organization ID

Example of improved error message:
```javascript
// Before:
"Missing required fields: name, activity_start_date, activity_start_time, activity_end_date, activity_end_time, meeting_location_going, meeting_time_going, departure_time_going"

// After (when only meeting_time_going is missing):
"Missing required fields: meeting_time_going"
```

## Testing
Created comprehensive test suite in `test/activities.create.test.js` covering:
- Creating activity with all required fields
- Rejecting activity with missing required fields  
- Handling empty strings in optional fields
- Verifying specific error messages for missing fields

## Files Changed
- `spa/modules/modals/QuickCreateActivityModal.js` - Frontend form handling
- `routes/activities.js` - Backend validation logic
- `test/activities.create.test.js` - New test suite (created)

## Usage
Users can now create activities through the Quick Create modal without encountering false "missing fields" errors. If there actually is a missing field, the error message will specifically identify which field needs to be filled.

## Future Improvements
- Consider adding client-side validation to catch missing fields before submission
- Consider extracting cleanFormData to a shared utility module if other forms need it
- Consider adding visual indicators for which fields are required vs optional
