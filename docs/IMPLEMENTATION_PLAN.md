# Wampums: Implementation Plan to Exceed ScoutsTracker

**Date:** 2026-02-05
**Version:** 3.0.6 baseline
**Goal:** Close every competitive gap with ScoutsTracker and extend Wampums' existing advantages into clear differentiators.

---

## Executive Summary

ScoutsTracker ($44.95/year per section) is primarily a **badge tracker with event management**. Wampums is already a **full operations platform** (finance, communication, carpools, inventory, forms, multi-org management). However, ScoutsTracker holds edges in six specific areas: offline depth, calendar subscriptions, badge dependency intelligence, program planning reports, youth-facing UX, and digital signatures.

This plan closes those six gaps and adds four additional improvements drawn from ScoutsTracker's recent release patches that would bring immediate polish to Wampums.

---

## Phase 1: Quick Wins (Low Effort, High Polish)

These items require minimal new architecture and can be shipped independently.

### 1.1 Payment Method Breakdown in Finance Reports

**Problem:** `finance.js` records payment methods (cash, cheque, e-transfer, card) per transaction but reports only show aggregate totals. ScoutsTracker added per-method breakdowns in their Dec 2025 patch.

**Files to modify:**
- `spa/finance.js` — `renderReportsSection()` (line ~528)
- `routes/finance.js` — Add aggregation query grouping payments by `payment_method`

**Implementation:**
1. Add a backend endpoint or extend `GET /api/v1/finance/report` to return totals grouped by `payment_method`
2. Render a breakdown table in the reports tab:
   ```
   Cash:        $1,240.00 (42%)
   E-Transfer:  $890.00   (30%)
   Card:        $650.00   (22%)
   Cheque:      $180.00   (6%)
   ```
3. Add translation keys for payment method names

**Acceptance criteria:**
- Finance reports tab shows per-method totals and percentages
- Data respects organization_id filtering
- Works in both EN and FR

---

### 1.2 Search on Finance, Activities, and Attendance Pages

**Problem:** Search is implemented in 4+ modules but missing from finance (memberships table), activities list, and attendance page. ScoutsTracker highlights platform-wide search.

**Files to modify:**
- `spa/finance.js` — Add search input to memberships tab
- `spa/activities.js` — Add search input above activity cards
- `spa/attendance.js` — Add participant search/filter

**Implementation:**
1. Reuse the debounce pattern from `utils/PerformanceUtils.js`
2. Add `<input type="search">` with consistent styling and `translate('search')` placeholder
3. Filter client-side using lowercase comparison (existing pattern)
4. Preserve search term across re-renders

**Acceptance criteria:**
- Real-time filtering as user types
- Case-insensitive matching on name fields
- Consistent UX with existing search in `district_management.js`

---

### 1.3 Rapid-Click / Double-Submit Protection

**Problem:** Button disabling during async operations is inconsistent. `finance.js` delete buttons, `carpool_dashboard.js` assignment buttons, and several other mutation triggers lack protection.

**Files to modify:**
- `spa/finance.js` — All delete/create/update buttons
- `spa/carpool_dashboard.js` — Assignment buttons
- `spa/attendance.js` — Status toggle buttons
- `spa/permission_slip_dashboard.js` — Send/remind buttons

**Implementation:**
1. Create a small utility (or extend `PerformanceUtils.js`):
   ```javascript
   export function withButtonLoading(button, asyncFn) {
     if (button.disabled) return;
     button.disabled = true;
     const originalText = button.innerHTML;
     button.classList.add('button--loading');
     return asyncFn()
       .finally(() => {
         button.disabled = false;
         button.innerHTML = originalText;
         button.classList.remove('button--loading');
       });
   }
   ```
2. Apply to all write-operation buttons across modules

**Acceptance criteria:**
- No double-submits possible on any mutation button
- Visual loading indicator during async operations
- Button re-enables on success or failure

---

### 1.4 12-Hour / 24-Hour Time Format Preference

**Problem:** `DateUtils.js:formatTime()` always outputs 24-hour. ScoutsTracker added a 24-hour toggle; many Canadian parents expect 12-hour format.

**Files to modify:**
- `spa/utils/DateUtils.js` — `formatTime()`, `formatTimestamp()`
- `spa/config.js` — Add `TIME_FORMAT` setting
- `spa/modules/account-info.js` — Add user preference toggle
- `lang/en.json`, `lang/fr.json` — Add "am"/"pm" and setting labels

**Implementation:**
1. Add `TIME_FORMAT` to user preferences (stored in localStorage)
2. Update `formatTime(hours, minutes)`:
   ```javascript
   export function formatTime(hours, minutes) {
     const use24h = getStorage('timeFormat', false, '24h') === '24h';
     if (use24h) {
       return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
     }
     const period = hours >= 12 ? 'PM' : 'AM';
     const h12 = hours % 12 || 12;
     return `${h12}:${String(minutes).padStart(2, '0')} ${period}`;
   }
   ```
3. Add toggle in account settings

**Acceptance criteria:**
- User can toggle 12h/24h in account settings
- All displayed times respect the preference
- `<input type="time">` fields unaffected (browser handles those)

---

### 1.5 Invalid Share Link Handling

**Problem:** Modules handle missing resources inconsistently. Some show inline errors, others fail silently or show a generic 404.

**Files to modify:**
- `spa/router.js` — Improve 404 handler
- `spa/carpool_dashboard.js`, `spa/permission_slip_sign.js`, other parameterized routes

**Implementation:**
1. Create a reusable "resource not found" template:
   ```javascript
   export function renderNotFound(resourceType, lang) {
     return `
       <div class="not-found-state">
         <h2>${translate('resource_not_found_title')}</h2>
         <p>${translate('resource_not_found_message', { type: resourceType })}</p>
         <a href="/dashboard" class="button button--primary">${translate('back_to_dashboard')}</a>
       </div>`;
   }
   ```
2. Apply to all modules that load resources by ID
3. Handle the case where a shared link points to a deleted resource with a friendly message

**Acceptance criteria:**
- All parameterized routes show a consistent "not found" page
- Message is translated EN/FR
- Navigation back to dashboard is always available

---

## Phase 2: Competitive Parity (Medium Effort, Strategic)

These close the headline feature gaps with ScoutsTracker.

### 2.1 Calendar Subscription (iCal Export)

**Problem:** ScoutsTracker offers calendar subscription. Parents can't add Wampums events to their phone calendars.

**New files:**
- `routes/calendar-feed.js` — iCal feed endpoint
- `spa/` — "Subscribe to Calendar" button on parent dashboard

**Implementation:**
1. Create `GET /api/v1/calendar/:organizationId/feed.ics` endpoint:
   - Authenticate via query token (for calendar app compatibility)
   - Generate `.ics` format from activities table
   - Include VEVENT entries with DTSTART, DTEND, SUMMARY, LOCATION, DESCRIPTION
   - Set `Content-Type: text/calendar; charset=utf-8`
2. Add a "Subscribe" button in parent dashboard that copies the `webcal://` URL
3. Add a "Download Calendar" button that downloads a static `.ics` file of upcoming events
4. Optionally support Google Calendar add link:
   ```
   https://calendar.google.com/calendar/render?cid=webcal://wampums.app/api/v1/calendar/{orgId}/feed.ics
   ```

**Acceptance criteria:**
- Parents can subscribe in Apple Calendar, Google Calendar, Outlook
- Feed updates automatically as activities change
- Token-based auth prevents unauthorized access
- Works for both parent and leader roles

---

### 2.2 Financial CSV/Excel Export

**Problem:** ScoutsTracker added .xls/.csv export in their July 2025 patch. Wampums has `CONFIG.FEATURES.EXPORT_REPORTS = true` but no download action.

**Files to modify:**
- `spa/finance.js` — Add "Export" button to reports tab
- `spa/reports.js` — Add export capability to report views
- New utility: `spa/utils/ExportUtils.js`

**Implementation:**
1. Create `ExportUtils.js` with:
   ```javascript
   export function exportToCSV(data, columns, filename) {
     const header = columns.map(c => c.label).join(',');
     const rows = data.map(row =>
       columns.map(c => `"${String(row[c.key] || '').replace(/"/g, '""')}"`).join(',')
     );
     const csv = [header, ...rows].join('\n');
     downloadBlob(csv, filename, 'text/csv');
   }
   ```
2. Add "Export CSV" button to finance reports, attendance reports, and participant reports
3. Include date range filter for financial exports
4. Support bilingual column headers based on current language

**Acceptance criteria:**
- CSV downloads with proper encoding (UTF-8 BOM for Excel compatibility)
- Date range filtering for financial data
- Column headers in current language
- Works offline from cached data

---

### 2.3 Soft Resync Without Page Reload

**Problem:** `pwa-update-manager.js` does `window.location.reload(true)`. ScoutsTracker changed their "Reload from Server" to resync data without losing the page state.

**Files to modify:**
- `spa/pwa-update-manager.js` — Add soft resync option
- `spa/modules/OfflineManager.js` — Expose `resyncAll()` method
- `spa/app.js` — Add "Refresh Data" action

**Implementation:**
1. Add a `resyncAll()` method to OfflineManager:
   ```javascript
   async resyncAll() {
     await clearAllFeatureCaches(); // Use existing clearXxxRelatedCaches()
     // Re-fetch critical endpoints
     await this.preCacheCriticalData();
     // Dispatch event so current module re-renders
     window.dispatchEvent(new CustomEvent('dataResync'));
   }
   ```
2. Add a "Refresh Data" button in the app header or settings
3. Modules listen for `dataResync` event and call their `loadData()` + `render()` methods
4. Keep hard reload as fallback for PWA version updates only

**Acceptance criteria:**
- User can refresh all data without losing their current page/scroll position
- Current module re-renders with fresh data
- Cache is fully cleared and repopulated
- PWA version updates still use full reload when necessary

---

### 2.4 Session Details Display

**Problem:** No session info shown to users. ScoutsTracker added session timestamps and URIs.

**Files to modify:**
- `spa/login.js` — Record login timestamp
- `spa/modules/account-info.js` — Display session info
- `spa/utils/StorageUtils.js` — Store login metadata

**Implementation:**
1. On successful login, store `loginTimestamp` in localStorage
2. In account settings, show:
   ```
   Logged in: Feb 5, 2026 at 2:30 PM
   Session: 3 hours ago
   Device: Chrome on macOS
   ```
3. Use `navigator.userAgent` for device info (parsed simply, not a full library)
4. Use `getRelativeTime()` from DateUtils for "3 hours ago" display

**Acceptance criteria:**
- Login time displayed in account settings
- Relative time updates on page visibility change
- Device/browser shown
- Translatable EN/FR

---

## Phase 3: Competitive Advantage (Higher Effort, Differentiating)

These go beyond parity and make Wampums clearly superior.

### 3.1 Badge Prerequisite Dependencies and "Ready to Start" Indicators

**Problem:** ScoutsTracker's headline is "automatic requirement calculation with dependency linking." Wampums has `determineNextLevel()` for within-badge progression but no cross-badge prerequisites.

**Database changes:**
- New table: `badge_prerequisites`
  ```sql
  CREATE TABLE badge_prerequisites (
    id SERIAL PRIMARY KEY,
    badge_id INTEGER REFERENCES badges(id),
    prerequisite_badge_id INTEGER REFERENCES badges(id),
    prerequisite_level INTEGER DEFAULT 1,
    organization_id INTEGER REFERENCES organizations(id),
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```

**Files to modify:**
- `routes/badges.js` — Extend badge queries to include prerequisite status
- `spa/badge_dashboard.js` — Show "ready to start" / "locked" indicators
- `spa/badge_tracker.js` — Show prerequisite chain visualization

**Implementation:**
1. Admin configures prerequisite relationships (Badge A requires Badge B at level 2)
2. When rendering the badge dashboard, check each participant's completed badges against prerequisites
3. Show visual indicators:
   - Locked (prerequisites not met) — grey with lock icon
   - Ready (prerequisites met, not started) — highlighted with "Start" prompt
   - In Progress — standard display with progress bar
   - Complete — checkmark
4. Add a "What do I need?" view that shows the prerequisite chain for any badge

**Acceptance criteria:**
- Admin can define badge prerequisites
- Dashboard shows lock/ready/progress/complete states
- Prerequisite chain is viewable per badge
- Works with existing badge level system

---

### 3.2 Program Progression Planning Report ("Smart Meeting Planner")

**Problem:** ScoutsTracker's Apr 2025 patch added "low-hanging fruit" analysis. This is a killer feature for meeting planning.

**New files:**
- `routes/reports-progression.js` — Planning analysis endpoint
- `spa/progression-planner.js` — UI module

**Implementation:**
1. Backend query analyzes badge progress across all participants:
   ```sql
   -- Find participants closest to completing a badge
   SELECT p.id, p.first_name, p.last_name, b.name as badge_name,
          COUNT(completed_reqs) as completed,
          COUNT(total_reqs) as total,
          COUNT(total_reqs) - COUNT(completed_reqs) as remaining
   FROM participants p
   JOIN badge_progress bp ON p.id = bp.participant_id
   WHERE bp.remaining <= 3  -- Close to completion
   ORDER BY bp.remaining ASC
   ```
2. Generate three report views:
   - **Almost There:** Participants within 1-3 requirements of completing a badge
   - **Maximum Impact:** Requirements that, if completed, would advance the most participants simultaneously
   - **Meeting Suggestions:** "If you do [activity], [8 kids] get credit toward [badge]"
3. Allow leaders to click "Plan Meeting Around This" to pre-fill a meeting plan

**Acceptance criteria:**
- Report shows participants closest to badge completion
- "Maximum impact" view identifies high-value activities
- Clickable link to create meeting plan from suggestion
- Filtered by organization and active participants only

---

### 3.3 Youth Dashboard with Achievement Timeline

**Problem:** ScoutsTracker has dedicated youth login with progress tracking and bookmarking. Wampums youth use the parent dashboard.

**New files:**
- `spa/youth-dashboard.js` — Youth-specific dashboard

**Implementation:**
1. Detect youth role on login, route to `/youth-dashboard`
2. Dashboard sections:
   - **My Progress:** Visual progress bars for all active badges with percentage
   - **Achievement Timeline:** Chronological feed of earned badges/honors with dates
   - **Next Steps:** Top 3 closest-to-completion badges with specific remaining requirements
   - **My Upcoming Events:** Activities with RSVP status
3. Design for engagement:
   - Progress bars with animations on load
   - Milestone celebrations ("You're 90% to your Outdoor Adventure badge!")
   - Simple, visual layout (less text, more icons/progress visuals)
4. No administrative actions — read-only view

**Acceptance criteria:**
- Youth see a dedicated, engaging dashboard
- Badge progress shown with visual progress bars
- Achievement timeline is chronological
- "Next steps" shows actionable items
- Mobile-friendly, touch-optimized

---

### 3.4 Digital Signature Capture on Forms

**Problem:** ScoutsTracker has electronic form approval workflows. Wampums permission slips use token links but have no actual signature capture.

**Files to modify:**
- `spa/permission_slip_sign.js` — Add signature canvas
- New utility: `spa/utils/SignatureUtils.js`

**Implementation:**
1. Add HTML5 Canvas signature pad to permission slip signing page:
   ```javascript
   export class SignaturePad {
     constructor(canvas) {
       this.canvas = canvas;
       this.ctx = canvas.getContext('2d');
       this.drawing = false;
       this.points = [];
       // Touch and mouse event handlers
     }
     toDataURL() { return this.canvas.toDataURL('image/png'); }
     clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
     isEmpty() { return this.points.length === 0; }
   }
   ```
2. Store signature as base64 PNG in the database with audit metadata:
   ```json
   {
     "signature_data": "data:image/png;base64,...",
     "signed_at": "2026-02-05T14:30:00Z",
     "signer_name": "Jane Smith",
     "signer_ip": "192.168.1.1",
     "user_agent": "Mozilla/5.0..."
   }
   ```
3. Show "Signed by [name] on [date]" with signature thumbnail in the dashboard
4. Support both drawn signature and "type your name" consent modes

**Acceptance criteria:**
- Touch-friendly signature canvas works on mobile
- Signature stored with audit trail (timestamp, IP, user agent)
- Leaders can view who signed and when
- Clear/redo functionality on the canvas
- Falls back to typed consent if canvas unavailable

---

### 3.5 Enhanced Offline Mode for Critical Flows

**Problem:** ScoutsTracker's #1 testimonial theme is "works flawlessly offline." Wampums queues writes but can't execute complex workflows offline.

**Files to modify:**
- `spa/modules/OfflineManager.js` — Expand critical endpoint list and write capabilities
- `spa/attendance.js` — Full offline attendance taking
- `spa/badge_dashboard.js` — Offline badge updates

**Implementation:**
1. Expand `CRITICAL_ENDPOINTS` to pre-cache:
   - Badge data and progress
   - Upcoming activities (next 30 days)
   - Participant list with group assignments
   - Health/allergy data (critical for camping)
2. Implement offline-capable attendance:
   - Load participant list from cache
   - Record attendance locally in IndexedDB
   - Show clear "offline — will sync when connected" indicator
   - Sync with conflict resolution on reconnection
3. Implement offline badge recording:
   - Record badge completions locally
   - Queue for approval sync
4. Add a pre-trip "Download for Offline" button that aggressively caches everything needed for a specific activity

**Acceptance criteria:**
- Attendance can be taken fully offline
- Badge progress can be recorded offline
- Health/allergy data available without connection
- "Download for Offline" caches activity-specific data
- Sync happens automatically on reconnection with conflict handling
- Clear visual indicators of offline state and pending sync count

---

## Phase 4: Timezone and Localization Polish

### 4.1 Timezone Offset for Travelling Groups

**Files to modify:**
- `spa/utils/DateUtils.js` — Add timezone-aware formatting
- `spa/modules/account-info.js` — Add timezone override setting

**Implementation:**
1. Add a "Travel timezone" setting that overrides display times
2. Use `Intl.DateTimeFormat` with explicit `timeZone` option
3. Show timezone indicator when override is active: "2:30 PM (EST, your local time is 3:30 PM)"

---

## Implementation Priority & Sequencing

| Priority | Item | Phase | Depends On |
|----------|------|-------|------------|
| 1 | Payment method breakdown | 1.1 | Nothing |
| 2 | Search on finance/activities | 1.2 | Nothing |
| 3 | Rapid-click protection | 1.3 | Nothing |
| 4 | 12h/24h time format | 1.4 | Nothing |
| 5 | Invalid share link handling | 1.5 | Nothing |
| 6 | Calendar subscription (iCal) | 2.1 | Nothing |
| 7 | CSV/Excel export | 2.2 | Nothing |
| 8 | Soft resync | 2.3 | Nothing |
| 9 | Session details | 2.4 | Nothing |
| 10 | Badge prerequisites | 3.1 | Database migration |
| 11 | Progression planning report | 3.2 | 3.1 (prerequisite data) |
| 12 | Youth dashboard | 3.3 | Nothing (but benefits from 3.1) |
| 13 | Digital signatures | 3.4 | Nothing |
| 14 | Enhanced offline mode | 3.5 | Nothing |
| 15 | Timezone offset | 4.1 | 1.4 (time format) |

Phase 1 items (1-5) can all be developed in parallel.
Phase 2 items (6-9) can all be developed in parallel.
Phase 3 items (10-14) should be sequenced: 3.1 before 3.2, everything else in parallel.

---

## Competitive Positioning After Implementation

| Feature | ScoutsTracker | Wampums (Current) | Wampums (After Plan) |
|---------|--------------|-------------------|---------------------|
| Badge tracking | Strong | Strong | Superior (prerequisites + planning) |
| Offline mode | Excellent | Basic | Strong (critical flows offline) |
| Calendar sync | Yes | No | Yes (iCal + Google) |
| Finance | Basic | Strong | Superior (export + breakdown) |
| Communication | None | WhatsApp + Email + Chat | WhatsApp + Email + Chat |
| Carpools | None | Full system | Full system |
| Digital forms | Basic | Good | Superior (signatures + audit) |
| Inventory | Basic | Full system | Full system |
| Online payments | None | Stripe | Stripe |
| Reports | Good | Good | Superior (progression planner) |
| Youth UX | Dedicated view | Via parent | Dedicated dashboard |
| Multi-org | Section + Commissioner | District + Admin | District + Admin |
| Languages | EN/FR | EN/FR/UK/IT/ID | EN/FR/UK/IT/ID |
| Mobile app | No (web only) | Native (Expo) | Native (Expo) |

After this plan, Wampums matches or exceeds ScoutsTracker in every category while maintaining clear advantages in finance, communication, carpools, inventory, mobile, and multilingual support.
