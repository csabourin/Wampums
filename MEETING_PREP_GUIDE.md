# Meeting Preparation Refactoring - Usage Guide

## Feature Overview

### 1. Default Next Meeting Loading
When the page loads, it automatically shows the next scheduled meeting with a date properly assigned.

```javascript
// On page initialization
const nextMeeting = await this.loadNextMeeting();
// Result: Meeting for next available date with placeholder activities
```

**User Experience:**
- Date field shows next meeting date
- Activities are empty placeholders
- User can edit and save

### 2. Load Previous Meeting as Template
Users can now select a previous meeting from the date dropdown to use as a template for a new meeting.

```javascript
// When user clicks date from dropdown
await this.loadMeetingAsTemplate(selectedDate);
// Result: Activities and location from previous meeting
//         NEW date is set to next available date
//         Notes are cleared (NOT copied)
```

**User Experience:**
1. Select a previous date from dropdown
2. Activities from that meeting are loaded
3. Location is copied
4. Date automatically resets to next meeting
5. User can modify and save as new meeting

### 3. AI-Generated Meeting Plans
Generate meeting activities with AI, including responsible animators and materials.

```javascript
// User clicks "Magic Generate Plan" button
const response = await aiGenerateText("meeting_plan", payload);

// Result: Activities populated with:
// - time, duration, activity description
// - responsable (if mentioned by AI)
// - materiel (if mentioned by AI)
// - NO notes are filled (user can add manually)
```

**Key Difference from Before:**
- ✅ Activities are populated with responsible and material
- ❌ Notes are NOT auto-filled with theme/goals/materials
- User retains control over meeting notes

### 4. Mobile-Optimized UI

#### Mobile (320px - 767px)
- All form fields stack vertically
- Single column layout for activities
- Full-width buttons wrapping naturally
- Minimum 44px touch targets
- Readable font sizes for small screens

#### Tablet (768px - 1023px)
- Two-column form layout where appropriate
- Activities table with grid layout
- Horizontal button groups
- Better spacing for larger screens

#### Desktop (1024px+)
- Full grid layout for activities
- Multiple column form sections
- Organized activity columns (time, duration, activity, responsable, materiel)
- Spacious layout with optimal reading widths

### 5. Improved Activity Serialization

Activities are now properly managed:

```javascript
// Activity structure
{
  id: "ai-generated-0",
  position: 0,
  time: "14:00",
  duration: "00:30",
  activity: "Opening Circle",
  responsable: "John Smith",      // Preserved from AI
  materiel: "Bell, Circle Markers", // Preserved from AI
  isDefault: false
}

// On save, serialized as JSON
activities: JSON.stringify([...activities])
```

**Best Practices:**
- Responsable names are preserved
- Materials are preserved when mentioned
- Default activities marked appropriately
- Proper type checking before serialization

## Code Quality Improvements

### Type Safety
```javascript
// Proper type checks for activities
if (formData.activities && typeof formData.activities !== 'string') {
    formData.activities = JSON.stringify(formData.activities);
}
```

### Error Handling
```javascript
try {
    // Operation
} catch (error) {
    debugError("Specific context:", error);
    this.app.showMessage(translate("user_friendly_message"), "error");
} finally {
    this.isLoadingTemplate = false;
}
```

### State Management
```javascript
// Track template loading state
this.isLoadingTemplate = true;
try {
    // Load template
} finally {
    this.isLoadingTemplate = false;
}
```

## Translation Keys

The following new keys are available for translation:

| Key | English | French |
|-----|---------|--------|
| `error_loading_meeting_template` | Error loading meeting template | Erreur lors du chargement du modèle |
| `meeting_not_found` | Meeting not found | Réunion introuvable |
| `template_loaded_successfully` | Meeting template loaded successfully | Modèle chargé avec succès |
| `meeting_notes_placeholder` | Add notes for this meeting... | Ajouter des notes... |
| `reminder_placeholder` | Add reminder text... | Ajouter le texte du rappel... |

## Developer Notes

### Constructor Properties
```javascript
this.previousMeetings = [];      // Cache for template meetings
this.isLoadingTemplate = false;  // Track loading state
```

### Key Methods

#### `loadNextMeeting()`
- **Purpose:** Load the default next meeting
- **Returns:** Meeting object with next date
- **Use:** On page initialization

#### `loadMeetingAsTemplate(date)`
- **Purpose:** Load previous meeting as template
- **Returns:** New meeting with copied activities but new date
- **Use:** When user selects previous date from dropdown
- **Important:** Does NOT copy notes

#### `loadMeeting(date)`
- **Purpose:** Load any meeting for viewing/editing
- **Returns:** Meeting data for that date
- **Use:** General date navigation

#### `handleMagicGenerate()`
- **Purpose:** Generate AI meeting plan
- **Note:** Only fills activities, NOT notes
- **Fields populated:** time, duration, activity, responsable, materiel

### Form Integration

The render method uses semantic HTML with accessibility:
```javascript
<label for="date-select" class="sr-only">${translate("select_date")}</label>
<select id="date-select" aria-label="${translate("select_date")}">
```

### Mobile-First CSS Pattern

```css
/* Mobile default */
.element {
  display: flex;
  flex-direction: column;
}

/* Tablet enhancement */
@media (min-width: 768px) {
  .element {
    flex-direction: row;
  }
}
```

## Testing Checklist

### Functionality
- [ ] Load next meeting on init
- [ ] Load previous meeting as template
- [ ] Verify notes are NOT copied when loading template
- [ ] Verify activities ARE copied with responsable/materiel
- [ ] Save meeting with activities
- [ ] Generate AI plan
- [ ] Risk analysis generates notes

### Mobile UX (375px)
- [ ] Form stacks vertically
- [ ] Buttons wrap and are readable
- [ ] All touch targets ≥ 44px
- [ ] Modals fit screen
- [ ] Scrolling works smoothly

### Accessibility
- [ ] Labels associated with inputs
- [ ] ARIA labels present
- [ ] sr-only content readable by screen readers
- [ ] Keyboard navigation works
- [ ] Focus visible on all interactive elements

### Translations
- [ ] All new keys present in en.json
- [ ] All new keys present in fr.json
- [ ] No hardcoded English text

## Common Issues & Solutions

### Issue: Notes appearing when loading template
**Solution:** Check `loadMeetingAsTemplate()` sets `notes: ''`

### Issue: Activities not saving
**Solution:** Ensure `handleSubmit()` serializes activities to JSON

### Issue: AI plan not populating activities
**Solution:** Check `handleMagicGenerate()` calls `setSelectedActivities()`

### Issue: Mobile buttons overlapping
**Solution:** Check `.meeting-actions button` has `flex: 1` and `min-width`

## Future Enhancement Ideas

1. **Template Library:** Pre-save common meeting templates
2. **Activity Reordering:** Drag-and-drop on desktop, swipe on mobile
3. **Bulk Operations:** Edit multiple activities at once
4. **Quick Actions:** Keyboard shortcuts for common tasks
5. **Draft Saving:** Auto-save drafts to prevent data loss
6. **Meeting History:** View and compare previous meetings
