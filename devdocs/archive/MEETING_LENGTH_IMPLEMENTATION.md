# Meeting Length & Template Placeholder Implementation

## Overview
Implemented smart template placeholder management based on meeting duration. Template activities are now only added when the actual scheduled meeting time is less than the planned meeting duration.

## Changes Made

### 1. Database Migration
**File:** `migrations/add_meeting_length_setting.sql`

- Adds `meeting_length` setting to `organization_settings` table for each organization
  - Default: 120 minutes (2 hours)
  - Format: `{"duration_minutes": 120}`
- Adds `duration_override` column to `reunion_preparations` table
  - Allows special meetings (camps, multi-day events) to override the default meeting length
  - NULL = use organization default, number = override in minutes
  - Minimum: 15 minutes (validated)
- Adds `metadata` column for future extensibility

### 2. Frontend - Web (SPA)

#### `spa/modules/ActivityManager.js`
- Added `meetingLengthMinutes` property (default: 120)
- Added `durationOverride` property for special meeting overrides
- New method `setMeetingLength(lengthMinutes, durationOverride)` to configure meeting duration
- New method `calculateMeetingDuration(activities)` that:
  - Analyzes existing activities
  - Calculates total time span from first activity start to last activity end
  - Returns duration in minutes
- Updated `initializePlaceholderActivities(existingActivities)` to:
  - Accept optional existing activities parameter
  - Check if actual meeting duration ≥ planned duration
  - Only add templates if actual < planned
  - Preserve non-default activities and append templates as needed

#### `spa/preparation_reunions.js`
- Reads `meeting_length` from organization settings on initialization
- Calls `setMeetingLength()` on ActivityManager to configure duration expectations
- Added new form field for "Special Meeting Duration (optional)"
  - Allows override for camps, special events, etc.
  - Input type: number (minutes)
  - Minimum: 15 minutes, step: 15 minutes

#### `spa/modules/FormManager.js`
- Updated `populateForm()` to:
  - Pass loaded activities to `initializePlaceholderActivities()`
  - Set `duration_override` field if available
  - Update ActivityManager with override when loading existing meeting
- Updated `extractFormData()` to:
  - Extract `duration_override` field from form
  - Only include it in submission if set
- Updated `resetForm()` to pass null to initialization

### 3. Frontend - Mobile (React Native)

#### `mobile/src/utils/ActivityManager.js`
- Mirror of web ActivityManager
- Same duration calculation logic
- Same placeholder initialization behavior
- `initializePlaceholderActivities()` accepts existing activities

### 4. Backend API

#### `routes/meetings.js` - POST `/save-reunion-preparation`
- Added validation: `duration_override` must be ≥ 15 minutes
- Updated INSERT/UPSERT query to:
  - Accept `duration_override` parameter
  - Save it to `reunion_preparations` table
  - Include it in UPDATE clause for existing meetings

### 5. Translations

#### `lang/en.json`
- `special_meeting_duration`: "Special Meeting Duration (optional)"
- `leave_empty_for_default`: "Leave empty to use the default"
- `duration_minutes_placeholder`: "Duration in minutes"
- `duration_override_help`: Help text explaining override usage

#### `lang/fr.json`
- `special_meeting_duration`: "Durée spéciale de réunion (optionnel)"
- `leave_empty_for_default`: "Laisser vide pour utiliser la valeur par défaut"
- `duration_minutes_placeholder`: "Durée en minutes"
- `duration_override_help`: French help text

## How It Works

### Normal Meeting (Using Default Duration)
1. User loads a meeting date or creates a new meeting
2. System checks organization's `meeting_length` setting (e.g., 120 minutes)
3. If existing activities total < 120 minutes, template placeholders are added
4. User can edit, remove, or keep placeholder activities
5. If user fills all 120 minutes (or more), templates won't be added next time

### Special Meeting (Camp, Multi-Day Event)
1. User creates a new meeting or loads existing one
2. User sets "Special Meeting Duration" field (e.g., 240 minutes for 4-hour camp)
3. System uses override instead of default when calculating if templates needed
4. On save, `duration_override` is stored with the meeting
5. Next time meeting is loaded, override is applied

### Template Logic
```
If (calculated_meeting_duration >= planned_duration):
  → Don't add templates (user has filled the time)
Else:
  → Add templates to fill remaining time
```

## Running the Migration

```bash
npm run migrate add_meeting_length_setting
```

Or manually:
```bash
psql -d your_database < migrations/add_meeting_length_setting.sql
```

## Configuration

### Setting Default Meeting Length
Admin can update organization settings to change default duration:

```javascript
// Via API or admin panel, update organization_settings:
{
  "setting_key": "meeting_length",
  "setting_value": {
    "duration_minutes": 120  // 2 hours
  }
}
```

Current defaults:
- Web: 120 minutes (2 hours) - hardcoded fallback
- Mobile: 120 minutes (2 hours) - hardcoded fallback

## Example Scenarios

### Scenario 1: 2-Hour Standard Meeting
- Default duration: 120 minutes
- Leader schedules: 18:30 - 19:45 (activity 1), 19:45 - 20:00 (activity 2)
- Total: 90 minutes < 120 minutes
- System adds template placeholders for remaining 30 minutes

### Scenario 2: Fully Scheduled Meeting
- Default duration: 120 minutes
- Leader schedules: 18:30 - 19:30 (activity 1), 19:30 - 20:30 (activity 2)
- Total: 120 minutes ≥ 120 minutes
- No templates added (meeting is full)

### Scenario 3: Weekend Camp Override
- Default duration: 120 minutes
- Leader sets special duration: 480 minutes (8 hours)
- Existing activities: 240 minutes
- System adds templates for remaining 240 minutes
- On next load, 480-minute duration is remembered

## Benefits

1. **No More Unused Templates** - Templates only appear when there's time to fill
2. **Flexibility** - Special events can override standard duration
3. **Smart** - System automatically adjusts based on actual scheduled time
4. **User-Friendly** - Optional field (defaults to organization standard)
5. **Data Persistence** - Override is saved and remembered for each meeting
