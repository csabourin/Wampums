# User Story Catalog — Wampums Scout Management

**Scope:** attendance, points, honors, activities, offline/camp mode, and their cross-module
interactions, told from the user's point of view. Every story ID below maps to a `describe`
block in `test/user-stories/*.stories.test.js`.

**Personas**

| Persona | Description |
|---|---|
| leader | Unit leader with `attendance.manage`, `points.manage`, `honors.create`, `activities.create` |
| parent | Read-mostly user (`*.view` permissions only) |
| admin | Org admin (all permissions) |
| demo | Demo-role account — every write returns 403 with `isDemo: true` |
| visitor | Unauthenticated — 401 on protected endpoints |

**ID scheme:** `US-<MODULE>-<NNN>` with modules ATT, PTS, HON, ACT, OFF, INT (cross-module),
PERM, NAV, I18N.

**Implementation files**

| File | Stories |
|---|---|
| `points-store.stories.test.js` | US-PTS-004..009, US-PTS-018 |
| `manage-points.stories.test.js` | US-PTS-001..003, 005, 010..012, 019, US-NAV-001 |
| `attendance.stories.test.js` | US-ATT-001..002, 004..012, 017..020, US-NAV-002 |
| `manage-honors.stories.test.js` | US-HON-001..003, 008..013 |
| `offline.stories.test.js` | US-OFF-001..005, 007 |
| `backend-attendance.stories.test.js` | US-ATT-003, 013..016, US-PERM-001..003 |
| `backend-points.stories.test.js` | US-PTS-013..017, US-PERM-004 |
| `backend-honors.stories.test.js` | US-HON-004..007, 015 |
| `backend-activities.stories.test.js` | US-ACT-005, 006 |
| `interactions.stories.test.js` | US-INT-001..008 |
| (static, in each file) | US-I18N-001 |

---

## Attendance (spa/attendance.js + routes/attendance.js)

### US-ATT-001 — See my unit grouped, with honest statuses
As a unit leader,
when I open the attendance page,
I want participants grouped by their group with leaders first and unrecorded statuses shown as "unmarked",
so that what I see matches exactly what is persisted (no fake "everyone present" default).

Covers: Attendance.init, Attendance.preloadAttendanceData, Attendance.fetchData,
        Attendance.buildGroupsFromParticipants, Attendance.render, Attendance.renderGroupsAndNames,
        Attendance.renderSkeleton, Attendance.renderSkeletonGroups, Attendance.renderSkeletonGuests
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given 4 participants in 2 groups and one recorded status (present)
  When the leader opens /attendance
  Then a skeleton shows first, then each group renders as a card with its members
  And the recorded participant shows the translated "present" chip
  And every unrecorded participant shows the translated "unmarked" chip, never "present"
  And leaders sort before non-leaders inside a group

### US-ATT-002 — Mark one kid present instantly
As a unit leader,
when I select a participant and tap "present",
I want the chip to flip immediately and the change saved in the background,
so that I can keep moving down the line.

Covers: Attendance.attachEventListeners, Attendance.toggleIndividualSelection,
        Attendance.updateStatus, Attendance.updateIndividualStatus,
        Attendance.updateAttendanceDisplay, Attendance.writeAttendanceCache
Priority: P1   Personas: leader   Modes: online, offline
Acceptance:
  Given the page is loaded and a participant is selected
  When the leader taps "present"
  Then the row chip reads translated "present" before the server responds
  And updateAttendance is called with (participantId, 'present', currentDate, previousStatus=null)
  And on success a translated success toast shows and the per-date cache is rewritten

### US-ATT-003 — First-time marking earns the right points (server)
As a leader,
when I mark attendance,
I want the server to insert the correct point adjustment from its own recorded baseline,
so that totals never drift from client guesses.

Covers: POST /v1/attendance, utils/api-helpers.calculateAttendancePoints, utils.getPointSystemRules
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given no attendance row exists (baseline null) and rules {present: 1}
  When POST /v1/attendance {status: 'present'} succeeds
  Then a points row of +1 is inserted and the 201 envelope includes previous_status: null
  Given a recorded 'present' row and the same request again
  Then no points row is inserted (status unchanged)
  And rules in `{present: {points: 1}}` object shape produce the same +1

### US-ATT-004 — Mark a whole group at once, partial failures roll back individually
As a leader,
when I select a group header and tap a status,
I want everyone in the group updated, and any member whose save failed reverted,
so that the screen never lies about what was saved.

Covers: Attendance.toggleGroupSelection, Attendance.updateGroupStatus
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given a group of 3 with no recorded statuses
  When the leader applies "present" to the group and the 2nd save fails
  Then members 1 and 3 show "present", member 2 reverts to "unmarked"
  And a translated group-attendance error toast shows

### US-ATT-005 — A failed save never leaves a phantom status
As a leader on flaky wifi,
when a single status save is rejected by the server,
I want the row restored to exactly its previous state with a translated error,
so that I know to retry.

Covers: Attendance.updateIndividualStatus (rollbackFn), utils/OptimisticUpdateManager.execute
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given a participant recorded as 'late'
  When marking 'absent' fails server-side
  Then the chip returns to translated "late" (not "absent", not "unmarked")
  And an error toast with the server (or generic translated) message shows

### US-ATT-006 — One tap marks everyone still unmarked as present
As a leader at the end of roll call,
when a few kids are still unmarked,
I want a "mark N remaining present" button that persists each of them,
so that I don't tap 12 more times.

Covers: Attendance.renderMarkRemainingButton, Attendance.getUnmarkedParticipantIds,
        Attendance.markAllRemainingPresent, Attendance.refreshMarkRemainingButton
Priority: P2   Personas: leader   Modes: online
Acceptance:
  Given 3 of 5 participants marked
  Then the button shows count 2 (from the translated template)
  When tapped, updateAttendance fires once per unmarked participant with previousStatus null
  And the button disappears when the count reaches 0
  And on failure the failed ids revert to unmarked

### US-ATT-007 — Carry-forward on day 2 of camp
As a unit leader at a 3-day camp,
when I open the attendance page on day 2 and nobody has been marked yet,
I want yesterday's present/late participants pre-filled and persisted,
so that I don't re-enter 40 kids every morning.

Covers: Attendance.autoCarryForward, Attendance.findCarryForwardSourceOnline,
        Attendance.getCampDates, POST /v1/attendance/carry-forward (client call)
Priority: P1   Personas: leader   Modes: online, camp-mode
Acceptance:
  Given a 3-day activity covering today (day 2) and day-1 attendance (2 present, 1 late, 1 absent)
  And no attendance exists for day 2
  When the leader opens /attendance
  Then 3 participants show present/late carried from day 1
  And the absent participant shows "unmarked" (not absent)
  And an info toast shows the carried-forward count and source date
  And POST v1/attendance/carry-forward was called with {fromDate, toDate}

### US-ATT-008 — Carry-forward still works with no signal
As a leader at a remote camp (offline),
when I open day 2 with no attendance yet,
I want the carry-forward to come from the cached day-1 data,
so that camp mornings work without a network.

Covers: Attendance.findCarryForwardSourceOffline, Attendance.parseAttendanceCacheEntry,
        Attendance.applyCacheEntry
Priority: P1   Personas: leader   Modes: offline, camp-mode
Acceptance:
  Given day-1 attendance cached in IndexedDB and navigator offline
  When the page initializes on day 2
  Then present/late statuses are pre-filled from the cache
  And no network carry-forward call is attempted

### US-ATT-009 — I can see which camp day I'm on
As a leader mid-camp,
when the selected date falls inside a multi-day activity,
I want a banner with the activity name and "Day X of Y",
so that I trust I'm marking the right day.

Covers: Attendance.detectActivityContext, Attendance.renderCampBanner
Priority: P2   Personas: leader   Modes: online, camp-mode
Acceptance:
  Given an activity spanning 3 days including today
  Then the banner shows the activity name and translated day label (Day 2 of 3)
  Given no covering activity
  Then no banner renders

### US-ATT-010 — Switching dates shows that day's data
As a leader reviewing last week,
when I pick another date from the dropdown,
I want fresh data for that date (and the camp context re-evaluated),
so that I never edit the wrong day.

Covers: Attendance.changeDate, Attendance.fetchAttendanceDates,
        Attendance.finalizeAvailableDates, Attendance.renderDateOptions
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given available dates including today and a past meeting date
  Then the dropdown lists them newest first, with today present and selected
  When the leader picks the past date
  Then that date's caches are cleared, data refetched and re-rendered

### US-ATT-011 — Add a visiting guest
As a leader,
when a guest attends tonight,
I want to record their name (email optional) on the current date,
so that head-counts are complete.

Covers: Attendance.addGuest, Attendance.renderGuests
Priority: P2   Personas: leader   Modes: online
Acceptance:
  Given an empty guest name, tapping "add" shows the translated required-name error and saves nothing
  Given a filled name, the guest is saved with the current date, appears in the list,
  the inputs clear, and a success toast shows

### US-ATT-012 — Find a kid by typing their name
As a leader of a big unit,
when I type in the search box,
I want the list filtered (debounced) with my focus preserved,
so that I can mark one kid fast.

Covers: Attendance.attachEventListeners (search), Attendance.renderGroupsAndNames (filter)
Priority: P2   Personas: leader   Modes: online
Acceptance:
  Given participants "Alex River" and "Sam Stone"
  When the leader types "alex" and the 300 ms debounce elapses
  Then only Alex's row renders and groups with no matches disappear

### US-ATT-013 — Every camp day is selectable as soon as the activity exists (server)
As a leader who planned a camp,
when I fetch attendance dates,
I want every day of active activities (≤ 31-day span) included,
so that day 2+ of camp is selectable before any attendance exists.

Covers: GET /v1/attendance/dates
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given the dates query unions attendance, meeting preparations and activity ranges
  Then the response is the standard success envelope with a date-string array
  And the SQL guards generate_series with the 31-day span parameter and is_active

### US-ATT-014 — The attendance API keeps orgs sealed off (server)
As an org admin,
when any attendance query runs,
I want organization_id filtering in every statement,
so that another organization's kids never appear.

Covers: GET /v1/attendance, GET /v1/attendance/dates (org scoping)
Priority: P1   Personas: admin   Modes: online
Acceptance:
  Given a token for org 1
  Then every SQL sent to the pool includes organization_id bound to org 1

### US-ATT-015 — Server-side carry-forward copies only what it should (server)
As a leader,
when the carry-forward endpoint runs,
I want only present/late copied, only for kids without a day-2 record,
so that absences are re-confirmed daily.

Covers: POST /v1/attendance/carry-forward (server behavior)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given the source query filters status IN ('present','late') AND NOT EXISTS on target date
  When 2 rows match, the response envelope reports copiedCount 2 with participants
  When 0 rows match, copiedCount is 0 with no insert
  And fromDate === toDate or missing dates return 400

### US-ATT-016 — Clearing a day removes only that org's records (server)
As an admin fixing a mistake,
when I delete a date's attendance,
I want only my org's rows for that date removed,
so that cleanup is safe.

Covers: DELETE /v1/attendance
Priority: P2   Personas: admin   Modes: online
Acceptance:
  Missing date → 400 with the standard error envelope
  With date → DELETE bound to (organizationId, date), envelope reports deleted count

### US-ATT-017 — Camp date math never explodes
As a leader,
when an activity is misconfigured with a runaway range,
I want the date enumeration capped,
so that the page never hangs generating years of dates.

Covers: Attendance.enumerateDateRange
Priority: P2   Personas: leader   Modes: any
Acceptance:
  3-day range → 3 dates inclusive, formatted from local components
  Range > 31 days → collapses to [startDate]
  Invalid dates → [startDate]

### US-ATT-018 — Statuses read correctly in both languages
As a French- or English-speaking leader,
when I look at any status chip or attendance toast,
I want a real translation in my language,
so that no page mixes languages.

Covers: lang/en.json + lang/fr.json keys used by attendance
Priority: P1   Personas: leader, parent   Modes: any
Acceptance:
  present/absent/late/excused/unmarked, attendance_updated, error_updating_attendance,
  group_attendance_updated, attendance_carried_forward, camp_day_of, mark_remaining_present
  all exist (non-empty) in BOTH en.json and fr.json

### US-ATT-019 — Old cached data still loads after an app update
As a leader whose device cached data under an older app version,
when the page reads any historical cache shape,
I want it normalized to the canonical form,
so that updates never wipe my camp prep.

Covers: Attendance.parseAttendanceCacheEntry (legacy shapes), Attendance.applyCacheEntry
Priority: P2   Personas: leader   Modes: offline, camp-mode
Acceptance:
  {data: ...} wrapper, attendance as array of {participant_id, attendance_status},
  attendance as map, raw group rows — all parse to {participants, attendanceMap, guests, groups}

### US-ATT-020 — Navigating away mid-load never paints over the next page
As a user who taps away while attendance is loading,
when the load finishes,
I want the attendance page NOT to render over my new page,
so that navigation feels solid.

Covers: Attendance.init (container guard), Attendance.render (container guard), Attendance.renderError
Priority: P2   Personas: any   Modes: online
Acceptance:
  Given init is in flight and the DOM no longer has .attendance-container
  Then render() does nothing
  Given the initial load throws, the translated error page renders instead

---

## Points (spa/manage_points.js, spa/modules/points/PointsStore.js, routes/points.js)

### US-PTS-001 — See group and member totals at a glance
As a leader,
when I open manage points,
I want groups with their group-total and member-sum footer, and each member's total,
so that the weekly standings are obvious.

Covers: ManagePoints.init, ManagePoints.preloadManagePointsData, ManagePoints.fetchData,
        ManagePoints.applyPointsData, ManagePoints.organizeParticipants, ManagePoints.render,
        ManagePoints.renderList, ManagePoints.renderGroupedList, ManagePoints.renderParticipantsForGroup,
        ManagePoints.renderParticipantItem, ManagePoints.renderUnassignedParticipants,
        ManagePoints.getGroupIndividualTotal, PointsStore.load, PointsStore.getMembersTotal
Priority: P1   Personas: leader   Modes: online, offline (cache)
Acceptance:
  Given 2 groups and 3 participants (one unassigned)
  Then each group header shows the store's group total
  And the group footer shows the sum of displayed member totals
  And the unassigned section lists the ungrouped participant

### US-PTS-002 — +5 shows instantly and sticks after the server confirms
As a leader,
when I select a member and tap +5,
I want the number to change immediately and stay correct once the server's absolute total arrives,
so that scoring feels instant and trustworthy.

Covers: ManagePoints.handleItemClick, ManagePoints.applySelection, ManagePoints.applyPointAction,
        ManagePoints.flushQueue, ManagePoints.onStoreChange, ManagePoints.selectedElement,
        ManagePoints.showPointChangeAnimation, ManagePoints.addHighlightEffect,
        PointsStore.applyOptimistic, PointsStore.confirmBatch, PointsStore.getParticipantTotal
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given a member with 10 points selected
  When the leader taps +5
  Then the row shows 15 before the response
  And after the server confirms totalPoints 15, it still shows 15 (no flicker/jump)
  And updatePoints was called with one payload {type:'individual'…points:5}

### US-PTS-003 — Group award skips kids who aren't here
As a leader on a meeting night,
when I award +3 to a group and attendance was taken today,
I want absent/excused members skipped locally (with an info toast) exactly as the server will skip them,
so that the optimistic numbers match the confirmed ones.

Covers: ManagePoints.loadTodayAttendance, ManagePoints.getEligibleGroupMemberIds,
        ManagePoints.applyPointAction (group branch)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given today's attendance: A present, B absent, C late (all in group G)
  When the leader awards +3 to G
  Then A and C each gain 3 optimistically, B's total is unchanged
  And an info toast built from points_skipped_absent_participants shows count 1
  And the payload includes date=today so the server applies the same rule

### US-PTS-004 — Numbers never jump backwards while I'm clicking fast
As a leader rapidly tapping +1/+3/-1,
when server responses are slow or arrive out of order,
I want every displayed total to equal confirmed base + pending deltas at all times,
so that the score never visibly rolls back.

Covers: PointsStore.applyOptimistic, PointsStore.confirmBatch, PointsStore.getParticipantTotal,
        PointsStore.getGroupTotal, PointsStore.addDeltas, PointsStore.txnIds
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Base 10; apply +3 then +1 → displayed 14 while both in flight
  Confirm the +3 batch (server total 13) → still 14 (13 base + 1 pending)
  Confirm the +1 batch (server total 14) → 14, no intermediate below 13
  Displayed never decreases at any step of the sequence

### US-PTS-005 — A rejected award undoes itself exactly
As a leader,
when the server rejects a batch,
I want the optimistic deltas removed and an error toast with the reason,
so that totals return to the last confirmed truth.

Covers: ManagePoints.flushQueue (error branch), PointsStore.rollbackBatch
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Base 10, tap +5 (shows 15), server responds 500
  Then the row shows 10 again
  And an error toast contains the translated error_updating_points text

### US-PTS-006 — Scoring keeps working with no signal
As a leader in a basement with no wifi,
when my batch can't reach the server,
I want it queued for sync and my totals folded in and cached,
so that a reload doesn't lose tonight's scores.

Covers: ManagePoints.flushQueue (queued + network-error branches), ManagePoints.updateCache,
        PointsStore.foldBatch
Priority: P1   Personas: leader   Modes: offline
Acceptance:
  When updatePoints resolves {queued: true}
  Then the deltas fold into base (display unchanged, hasPendingDeltas false)
  And the shared cache is rewritten with the folded totals
  When updatePoints throws a TypeError offline, the mutation is queued via offlineManager and folded

### US-PTS-007 — A background refresh can't erase my in-flight clicks
As a leader,
when fresh server data loads while an award is still in flight,
I want pending deltas preserved on top of the new base,
so that my click is never silently dropped from the display.

Covers: PointsStore.load (keeps pending), PointsStore.hasPendingDeltas
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Base 10, pending +3 (shows 13); load() arrives with server total 10
  Then displayed is still 13 and hasPendingDeltas() is true
  After confirm with total 13 → 13, pending drained

### US-PTS-008 — The server's word is final for group awards
As a leader,
when a group award confirms with member totals (including skipped members' unchanged totals),
I want every member's base snapped to the server's absolute numbers,
so that an optimistic guess about a skipped kid is corrected.

Covers: PointsStore.confirmBatch (group updates + memberTotals)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Optimistically +3 to members A and B; server confirms A=13 and B=10 (skipped)
  Then A displays 13, B displays 10, group base equals server group total

### US-PTS-009 — Store subscriptions are precise and safe
As the points page (on behalf of the leader),
when totals change,
I want listeners notified with exactly the changed entity ids and one bad listener not to break others,
so that the DOM updates surgically.

Covers: PointsStore.subscribe, PointsStore.emit, PointsStore.allIds, PointsStore.foldBatch,
        PointsStore.rollbackBatch (notification sets)
Priority: P2   Personas: leader   Modes: any
Acceptance:
  applyOptimistic notifies ["participant:1","group:5"] only
  A throwing listener does not prevent the second listener from receiving the event
  unsubscribe() stops further notifications

### US-PTS-010 — Sort by name, group, or points
As a leader,
when I toggle the sort buttons,
I want flat name/points ordering or the grouped view, with the active button highlighted,
so that I can read standings the way I think.

Covers: ManagePoints.sortItems, ManagePoints.renderFlatList, ManagePoints.toggleFilter,
        ManagePoints.applyFilter
Priority: P2   Personas: leader   Modes: any
Acceptance:
  Tapping "points" renders a flat list ordered ascending, tapping again descending
  The group filter hides non-matching rows and headers

### US-PTS-011 — I'm told when nothing is selected
As a leader,
when I tap +1 with no selection,
I want a translated "select something" error and no request,
so that points never land on the wrong kid.

Covers: ManagePoints.applyPointAction (guards), ManagePoints.renderError
Priority: P2   Personas: leader   Modes: any
Acceptance:
  No selection → error toast please_select_group_or_individual, updatePoints not called

### US-PTS-012 — Old cache formats still load
As a leader with a stale cache from an older build,
when the page reads the points cache,
I want raw API shapes ({data:{...}}, names vs participants) normalized,
so that no historical cache breaks the page.

Covers: ManagePoints.normalizePointsData, ManagePoints.refreshPointsData
Priority: P2   Personas: leader   Modes: offline
Acceptance:
  {data:{participants,groups}} and {names:[...]} shapes both produce canonical lists
  with numeric total_points

### US-PTS-013 — Group award, server side: attendance decides who gets points
As a leader,
when the server processes a group award with a date,
I want present/late members and the group credited, skipped members reported with their
unchanged totals — and everyone credited when attendance wasn't taken,
so that the group ledger matches reality.

Covers: POST /v1/points (group branch)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Attendance taken, member B absent → B in skippedParticipants with current total, no insert for B
  Group row inserted with participant_id NULL; response has memberTotals and group totalPoints
  No attendance rows for the date → all members credited
  Envelope: success() with data.updates

### US-PTS-014 — Group and member ledgers never mix (server)
As an admin,
when totals are computed,
I want group totals from group-attributed rows only and member totals from participant rows only,
so that the two scoreboards stay independent.

Covers: GET /v1/points
Priority: P1   Personas: admin, leader   Modes: online
Acceptance:
  The groups query separates participant_id IS NULL vs IS NOT NULL aggregations
  Response carries groups[].total_points and groups[].individual_total_points

### US-PTS-015 — You can't score another org's kid (server)
As an org admin,
when an individual update targets a participant outside my org,
I want the batch rejected and rolled back,
so that cross-tenant writes are impossible.

Covers: POST /v1/points (individual branch, org check + transaction rollback)
Priority: P1   Personas: admin   Modes: online
Acceptance:
  Participant lookup joined on participant_organizations returns no row → 500 error envelope,
  ROLLBACK issued, no points insert
  Non-array body → 400

### US-PTS-016 — Leaderboards for groups and individuals (server)
As a leader,
when I ask for the leaderboard,
I want top groups (group-attributed points only) or top individuals with group names,
so that Friday's announcement writes itself.

Covers: GET /v1/points/leaderboard
Priority: P2   Personas: leader, parent   Modes: online
Acceptance:
  type=groups → data rows with member_count, query uses participant_id IS NULL
  default → individuals ordered by total_points with limit applied

### US-PTS-017 — Full points report (server)
As an admin,
when I open the points report,
I want per-participant totals and honor counts in one payload,
so that end-of-season reviews are one click.

Covers: GET /v1/points/report
Priority: P2   Personas: admin   Modes: online
Acceptance:
  Requires reports.view; rows include total_points and honors_count; org-scoped

### US-PTS-018 — (merged into US-PTS-009) subscription lifecycle
Covers: PointsStore.subscribe, PointsStore.emit — see US-PTS-009.

### US-PTS-019 — My selection survives re-renders
As a leader,
when the list re-renders after a sort or refresh,
I want my selected group/member still highlighted (selection kept as data, not DOM),
so that my next +N goes where I intended.

Covers: ManagePoints.handleItemClick (toggle), ManagePoints.applySelection,
        ManagePoints.attachEventListeners
Priority: P2   Personas: leader   Modes: any
Acceptance:
  Select member, re-render list → row still has .selected
  Clicking the same row again deselects it

---

## Honors (spa/manage_honors.js + routes/honors.js)

### US-HON-001 — Tonight's honor board
As a leader,
when I open manage honors,
I want every participant listed with honors-to-date, last honor date, and today's honorees checked,
so that I can pick tonight's honorees fairly.

Covers: ManageHonors.init, ManageHonors.fetchData, ManageHonors.processHonors,
        ManageHonors.render, ManageHonors.renderHonorsList, ManageHonors.renderParticipantItem,
        ManageHonors.getSortIndicator
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Given 2 participants, one honored today with a reason
  Then the honored row is checked/selected with the sanitized reason visible
  And total honors counts only honors dated ≤ current date
  And the un-honored row is unchecked and enabled

### US-HON-002 — Award honors with a reason for each kid
As a leader,
when I check kids and tap "award honor",
I want a per-kid reason modal (required), optimistic marking, then server confirmation merged in,
so that every honor has a story and the UI never waits.

Covers: ManageHonors.awardHonor, ManageHonors.showReasonModal, ManageHonors.handleReasonSubmit,
        ManageHonors.closeReasonModal, ManageHonors.cancelHonorProcess, ManageHonors.submitHonors,
        ManageHonors.optimisticallyAddHonors, ManageHonors.applyAwardResults,
        ManageHonors.updateHonorsListUI, ManageHonors.attachEventListenersToListItems
Priority: P1   Personas: leader   Modes: online
Acceptance:
  No selection → translated select_individuals error
  Empty reason → translated honor_reason_required error, modal stays
  With reasons entered, awardHonor is called with [{participantId, date, reason}]
  Rows show as honored before the response; returned honorIds merge into the rows
  Success toast honors_awarded_successfully; cancel resets pendingHonors

### US-HON-003 — A failed award rolls the board back
As a leader,
when the server rejects the award,
I want the optimistic checkmarks refetched away and a translated error with the reason,
so that the board shows only real honors.

Covers: ManageHonors.submitHonors (error path)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Server responds success:false → error toast error_awarding_honor + message
  fetchData re-runs and the optimistic row is no longer marked honored

### US-HON-004 — Awarding one honor also awards its points (server)
As a leader,
when the server records an honor,
I want the honor row plus a +5 (rule-driven) points row linked by honor_id, deduped per day,
so that honors and points always agree.

Covers: POST /v1/honors (single)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  New honor → INSERT honors + INSERT points (value = rules.honors.award, honor_id set),
  result action 'awarded' with honorId
  Same participant/date again → action 'already_awarded', no new inserts

### US-HON-005 — Awarding several honors at once must work (server)
As a leader honoring three kids in one go,
when the batch insert runs,
I want every honor's created_by set to me and the bind parameters consistent,
so that multi-honor nights don't crash.

Covers: POST /v1/honors (batch insert placeholder layout)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  With 2+ new honors, the honors INSERT's highest $N placeholder equals its parameter count
  And created_by binds to req.user.id for every row
  (Expected to FAIL against current code — see RUN-REPORT: routes/honors.js:213-221)

### US-HON-006 — Fixing an honor's date moves its points too (server)
As a leader who honored on the wrong date,
when I PATCH the honor's date,
I want the linked points row's date synced, invalid input rejected, other orgs' honors invisible,
so that history stays coherent.

Covers: PATCH /v1/honors/:id
Priority: P1   Personas: leader   Modes: online
Acceptance:
  No fields → 400; bad date format → 400; reason > 1000 chars → 400
  Unknown/foreign honor → 404
  Date change → UPDATE honors + UPDATE points ... WHERE honor_id, success envelope

### US-HON-007 — Deleting an honor removes its points (server)
As a leader undoing a mistake,
when I DELETE an honor,
I want its linked points removed in the same transaction and a count reported,
so that totals drop accordingly.

Covers: DELETE /v1/honors/:id
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Foreign/unknown id → 404
  Valid id → DELETE points by honor_id then DELETE honor, envelope has pointsRemoved

### US-HON-008 — Undo window for fresh honors
As a leader who mis-tapped,
when an honor is less than 10 minutes old,
I want an "undo (Nmin)" menu item that deletes it without a confirm dialog,
so that slips are cheap to fix.

Covers: ManageHonors.getUndoTimeRemaining, ManageHonors.handleUndoHonor,
        ManageHonors.attachHonorActionListeners
Priority: P2   Personas: leader   Modes: online
Acceptance:
  Honor created 5 min ago → can_undo true, undo label shows remaining minutes
  Undo calls deleteHonor(id) and refetches; success toast honor_undone_successfully
  Honor created 20 min ago → no undo item (delete with confirm remains)

### US-HON-009 — The past is read-only
As a leader browsing history,
when I select a past date,
I want the award button disabled and rows non-interactive,
so that history can't be edited by accident.

Covers: ManageHonors.isPastDate, ManageHonors.handleItemClick (disabled guard)
Priority: P2   Personas: leader   Modes: any
Acceptance:
  Past date selected → awardHonorButton disabled, clicking a row doesn't check it

### US-HON-010 — Sort the board my way
As a leader,
when I click the name/honors/date column headers,
I want ascending/descending sorts with an indicator,
so that I can spot who's overdue for an honor.

Covers: ManageHonors.sortItems
Priority: P3   Personas: leader   Modes: any
Acceptance:
  Sort by honors asc puts fewest first; second click reverses; null last-dates sort to the end

### US-HON-011 — Pick a date, see that day's honors
As a leader,
when I change the date dropdown,
I want that date's data fetched and only its honorees marked,
so that each day stands alone.

Covers: ManageHonors.onDateChange, ManageHonors.updateHonorsListUI
Priority: P2   Personas: leader   Modes: online
Acceptance:
  Changing date refetches and re-renders; on a past date only honored rows are visible

### US-HON-012 — Edit an honor's reason or date from its menu
As a leader,
when I open a fresh honor's ⋮ menu,
I want edit-reason and change-date modals that PATCH and refresh,
so that records stay accurate.

Covers: ManageHonors.showEditReasonModal, ManageHonors.showEditDateModal
Priority: P2   Personas: leader   Modes: online
Acceptance:
  Empty reason → translated honor_reason_required, no PATCH
  Valid reason → updateHonor(id, {reason}) then refetch + success toast
  Valid new date → updateHonor(id, {date}) then refetch + success toast

### US-HON-013 — Honors caches don't go stale
As a leader moving between pages,
when honors change,
I want the honors cache keys cleared,
so that the next page load can't show pre-award data.

Covers: ManageHonors.clearHonorsCaches
Priority: P2   Personas: leader   Modes: online
Acceptance:
  v1/honors, v1/honors?date=<current>, v1/honors/history, recent_honors all deleted from IndexedDB

### US-HON-014 — Camp-prepared honors work offline
As a leader at camp,
when camp mode is on and honors were prepared,
I want the page fed from honors_all/participants_v2 caches with camp dates,
so that honors work without a network.

Covers: ManageHonors.fetchData (camp branch)
Priority: P2   Personas: leader   Modes: camp-mode
Acceptance:
  campMode + cached honors_all/participants_v2 → no network fetch, camp dates listed

### US-HON-015 — Honors API envelope and org isolation (server)
As any authenticated user with honors.view,
when I GET /v1/honors or /v1/honors/history,
I want the standard envelope with participants/honors/availableDates and org-scoped queries,
so that the SPA and mobile parse one shape.

Covers: GET /v1/honors, GET /v1/honors/history
Priority: P1   Personas: leader, parent   Modes: online
Acceptance:
  success envelope; every query binds organizationId; history filters
  (start_date/end_date/participant_id) appear in SQL only when supplied

---

## Activities (spa/modules/activities/Activities.js + routes/activities.js)

### US-ACT-001 — Upcoming and past activities, separated
As a parent or leader,
when I open the activities calendar,
I want upcoming activities listed and past ones collapsed,
so that what's next is front and center.

Covers: Activities.init, Activities.loadActivities, Activities.render, Activities.renderActivityCard
Priority: P1   Personas: leader, parent   Modes: online
Acceptance:
  One future and one past activity → future in "upcoming", past inside the collapsed section
  Load failure → translated error toast + empty state, page still renders

### US-ACT-002 — Search the calendar
As a parent,
when I type in the activity search box,
I want name/description matches only (debounced),
so that I find the winter camp fast.

Covers: Activities.attachEventListeners (search)
Priority: P3   Personas: parent   Modes: online
Acceptance:
  Typing "camp" then 300 ms → only matching cards render

### US-ACT-003 — Only people with the permission see write buttons
As a parent without create/edit/delete permissions,
when I view activities,
I want no add/edit/delete buttons rendered,
so that the UI matches what the API would allow.

Covers: Activities.constructor (permission flags), Activities.render (conditional buttons)
Priority: P1   Personas: parent, leader   Modes: online
Acceptance:
  Without activities.create → no #add-activity-btn; with it → button present

### US-ACT-004 — Delete asks first
As a leader,
when I delete an activity,
I want a destructive-confirm prompt and a refreshed list on success,
so that camps aren't lost to a stray tap.

Covers: Activities.deleteActivity
Priority: P2   Personas: leader   Modes: online
Acceptance:
  Cancel → no API call; confirm → deleteActivity(id) then reload + success toast

### US-ACT-005 — Activities API: validation, permissions, isolation (server)
As a leader,
when I create/update/delete activities,
I want field validation with specific messages, time-order checks, org scoping and demo blocking,
so that bad data can't enter the calendar.

Covers: GET /v1/activities, POST /v1/activities, PUT /v1/activities/:id, DELETE /v1/activities/:id
Priority: P1   Personas: leader, demo, visitor   Modes: online
Acceptance:
  POST without name/dates/meeting fields → 400 listing missing fields
  meeting_time_going >= departure_time_going → 400
  Valid POST → 201 envelope, INSERT bound to organizationId and req.user.id
  DELETE of another org's id → 404

### US-ACT-006 — Planning a camp makes its days selectable everywhere
As a leader,
when I create a 3-day activity,
I want each of its days to appear in the attendance dates,
so that camp attendance can start on day 1 with zero extra setup.

Covers: POST /v1/activities → GET /v1/attendance/dates (activity range union)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  After creating Jul 14–16, GET /v1/attendance/dates returns all three dates
  (also asserted as interaction US-INT-004)

### US-ACT-007 — AI-drafted activity description (catalog only)
As a leader,
when I use "magic generate",
I want an AI-drafted activity I can edit before saving.

Covers: Activities.showMagicGenerateModal, Activities.showActivityModal, Activities.handleActivitySubmit
Priority: P3   Personas: leader   Modes: online
Status: catalog-only — see "Intentionally uncovered" (AI dependency).

---

## Offline / Camp mode (spa/modules/OfflineManager.js)

### US-OFF-001 — Saving offline says "saved locally", not "error"
As a leader offline,
when any write goes through the offline-aware fetch,
I want a 202 {queued: true} response and the mutation stored,
so that the page treats it as success-with-sync-later.

Covers: OfflineManager.fetchWithOfflineSupport, OfflineManager.handleWriteOperation,
        OfflineManager.queueMutation, OfflineManager.storePendingMutation
Priority: P1   Personas: leader   Modes: offline
Acceptance:
  isOffline + POST → Response 202 with {success: true, queued: true} and translated message
  The mutation (url/method/headers/body) lands in IndexedDB via the fallback store

### US-OFF-002 — Reconnecting syncs my queue safely
As a leader back in coverage,
when the device comes online,
I want queued mutations replayed with a fresh auth header, permanent rejections discarded,
and retryable failures kept,
so that nothing is lost and nothing loops forever.

Covers: OfflineManager.handleOnline, OfflineManager.syncPendingData,
        OfflineManager.replayPendingMutations
Priority: P1   Personas: leader   Modes: offline→online
Acceptance:
  200 → record deleted; 400/404/409 → discarded; 500 → kept for retry
  Replay uses Authorization from the current jwtToken

### US-OFF-003 — Old-format queued point updates still sync
As a leader whose device queued points in the legacy format,
when sync runs,
I want all legacy updatePoints records batched into one POST v1/points,
so that upgrades never strand queued scores.

Covers: OfflineManager.replayPendingMutations (legacy branch)
Priority: P2   Personas: leader   Modes: offline→online
Acceptance:
  Two legacy records → exactly one POST with both payloads; success deletes both records

### US-OFF-004 — Reads fall back to cache when the network dies
As any user offline,
when a GET fails,
I want the cached response served,
so that pages still show data.

Covers: OfflineManager.handleReadOperation, OfflineManager.cacheData,
        OfflineManager.getCachedResponse
Priority: P1   Personas: any   Modes: offline
Acceptance:
  Successful GET caches its JSON; later failing GET returns a Response built from that cache

### US-OFF-005 — Camp mode remembers what was prepared
As a leader preparing for camp,
when camp mode is enabled for an activity,
I want prepared dates queryable and camp mode persisted/restored,
so that day-2 offline flows know their date range.

Covers: OfflineManager.enableCampMode, OfflineManager.disableCampMode,
        OfflineManager.isDatePrepared, OfflineManager.getPreparedActivityForDate,
        OfflineManager.generateDateRange, OfflineManager.savePreparedActivities,
        OfflineManager.restoreCampMode, OfflineManager.clearPreparedActivities
Priority: P1   Personas: leader   Modes: camp-mode
Acceptance:
  generateDateRange('2026-07-14','2026-07-16') → 3 dates
  After preparing, isDatePrepared(day2) true and getPreparedActivityForDate(day2) returns it
  enable → campModeChanged {enabled:true}; disable clears it

### US-OFF-007 — The app announces connection changes
As any user,
when the connection drops or returns,
I want offlineStatusChanged events and translated toasts,
so that every open page can react.

Covers: OfflineManager.handleOffline, OfflineManager.handleOnline,
        OfflineManager.updateOnlineStatus, OfflineManager.dispatchEvent, OfflineManager.showToast
Priority: P2   Personas: any   Modes: any
Acceptance:
  handleOffline → offlineStatusChanged {isOffline:true}; handleOnline → {isOffline:false} + sync

---

## Cross-module interactions

### US-INT-001 — Marking attendance changes point totals with no stale jump
As a leader,
when I take attendance and then open the points page,
I want the server-side point adjustments reflected and the points cache invalidated,
so that totals are fresh with no backwards jump on refresh.

Covers: POST /v1/attendance (points insert), spa/indexedDB.clearPointsRelatedCaches,
        ManagePoints.refreshPointsData
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Server: absent→present inserts the rule-driven adjustment row
  SPA: after invalidation, the cached manage_points_data key is gone and the points page
  fetches fresh totals and renders them (old cached total never shown)

### US-INT-002 — UI and server agree on who a group award skips
As a leader,
when I award group points on a day with attendance,
I want the optimistic skip-list to match the server's skip-list, and the confirm step to
snap any disagreement to the server's totals,
so that both screens end on identical numbers.

Covers: ManagePoints.getEligibleGroupMemberIds + POST /v1/points (group branch)
        + PointsStore.confirmBatch (skipped corrections)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Same attendance fixture drives both sides: identical eligible/skipped sets
  After confirmBatch with the server's memberTotals, displayed totals equal server totals

### US-INT-003 — Honors move the scoreboard
As a leader,
when I award or delete an honor,
I want point rows created/removed server-side and the points caches cleared client-side,
so that the points page reflects honors immediately.

Covers: POST /v1/honors + DELETE /v1/honors/:id (points side effects),
        spa cache invalidation contract (points caches cleared after honor mutations)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Award inserts a points row (honor_id linked); delete removes it and reports pointsRemoved
  After the mutation the points cache keys are cleared so the next read refetches

### US-INT-004 — A new camp lights up attendance
As a leader,
when I create a multi-day activity and open attendance on one of its days,
I want the day selectable, the camp banner shown, and day-2 carry-forward offered,
so that planning an activity is all the setup camp needs.

Covers: routes/activities POST + GET /v1/attendance/dates + Attendance.detectActivityContext
        + Attendance.renderCampBanner + Attendance.autoCarryForward
Priority: P1   Personas: leader   Modes: online, camp-mode
Acceptance:
  Server: created activity's date range appears in /v1/attendance/dates
  SPA: with the activity covering today (day 2), the banner shows and carry-forward runs

### US-INT-005 — Rapid-fire clicks with slow, out-of-order responses
As a leader spamming +1/+3/-1,
when responses resolve slowly and out of order,
I want one batch in flight at a time and displayed = base + pending at every step,
so that totals never jump backwards.

Covers: ManagePoints.applyPointAction + ManagePoints.flushQueue (serialization)
        + PointsStore invariant
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Click +3 while a batch is in flight, then +1: both queue; a single second batch flushes
  Displayed total is monotonically consistent (never below confirmed base) throughout

### US-INT-006 — Going offline mid-action loses nothing
As a leader whose wifi dies mid-award,
when the mutation is queued,
I want the optimistic totals folded and persisted so a reload shows them,
and the queue replayed on reconnect,
so that the evening's scores survive anything.

Covers: ManagePoints.flushQueue (queued) + PointsStore.foldBatch + ManagePoints.updateCache
        + OfflineManager.replayPendingMutations
Priority: P1   Personas: leader   Modes: offline→online
Acceptance:
  Queued award → cache contains the folded totals (what a reload would show)
  A fresh page instance preloading from that cache displays the folded totals
  Reconnect replay POSTs the queued mutation

### US-INT-007 — Every failure path restores the exact pre-action state
As a leader,
when any award or attendance change is rejected,
I want the UI byte-for-byte back at its pre-action state with a translated toast,
so that retrying is safe.

Covers: ManagePoints rollback (PointsStore.rollbackBatch) + Attendance rollback
        (OptimisticUpdateManager)
Priority: P1   Personas: leader   Modes: online
Acceptance:
  Points: totals, and cache, match pre-click values after a 500
  Attendance: chip text and attendanceData match pre-tap values after a failure

### US-INT-008 — Leaving and returning to a page doesn't double anything
As a leader navigating between pages,
when I come back to points or attendance and act once,
I want exactly one API call and one DOM effect,
so that revisits never double-award or double-mark.

Covers: ManagePoints.init/attachEventListeners lifecycle, Attendance.attachEventListeners
        (dateSelect re-binding), ManagePoints.applyPointAction via real click
Priority: P1   Personas: leader   Modes: online
Acceptance:
  init → navigate away (DOM replaced) → init again → click +1 once
  Then updatePoints was called exactly once with one payload
  Attendance: changing date after re-init triggers exactly one changeDate

---

## Permissions & auth (backend, representative per router)

### US-PERM-001 — Visitors are turned away
As an unauthenticated visitor,
when I call any protected endpoint,
I want a 401 with the standard error envelope,
so that nothing leaks.

Covers: middleware/auth.authenticate (via attendance routes)
Acceptance: GET /v1/attendance with no token → 401, success:false

### US-PERM-002 — Missing permission is explained
As a parent without attendance.manage,
when I try to mark attendance,
I want 403 with `required` and `missing` arrays,
so that the client can explain what's lacking.

Covers: middleware/auth.requirePermission (via attendance POST)
Acceptance: 403 body has success:false, required:['attendance.manage'], missing:['attendance.manage']

### US-PERM-003 — Demo accounts are read-only
As a demo user,
when I attempt any write (attendance, points, honors, activities),
I want 403 with isDemo: true,
so that demos can explore without changing data.

Covers: middleware/auth.blockDemoRoles (via attendance POST)
Acceptance: 403 body has isDemo: true and the demo message

### US-PERM-004 — Same rules on the points API
As demo/parent/visitor,
when I hit POST /v1/points,
I want 401/403(+missing)/403(+isDemo) respectively.

Covers: authenticate + requirePermission + blockDemoRoles on POST /v1/points
Acceptance: as US-PERM-001..003 but for the points router

---

## Navigation & i18n

### US-NAV-001 — No points permission, no points page
As a user without points.view,
when I navigate to /manage-points,
I want an immediate redirect to /dashboard with nothing fetched.

Covers: ManagePoints.init (canViewPoints guard)
Acceptance: router.navigate('/dashboard') called; getParticipants never called

### US-NAV-002 — No attendance permission, no attendance page
As a user without attendance.view,
when I navigate to /attendance,
I want an immediate redirect to /dashboard.

Covers: Attendance.init (canViewAttendance guard)
Acceptance: router.navigate('/dashboard') called; no data fetched

### US-I18N-001 — Every UI string in these flows exists in both languages
As a bilingual organization,
when any attendance/points/honors flow shows text,
I want its key present and non-empty in both en.json and fr.json,
so that no view ever mixes languages.

Covers: lang/en.json, lang/fr.json (keys used by the suites)
Acceptance: each suite asserts its keys exist in both files (helpers/i18n assertion)

---

## Coverage table (function → story IDs)

### spa/attendance.js (Attendance)
| Method | Stories |
|---|---|
| init | ATT-001, ATT-020, NAV-002 |
| preloadAttendanceData | ATT-001, ATT-008, INT-006 |
| parseAttendanceCacheEntry | ATT-008, ATT-019 |
| applyCacheEntry | ATT-008, ATT-019 |
| writeAttendanceCache | ATT-002, ATT-007, ATT-008 |
| buildGroupsFromParticipants | ATT-001 |
| fetchAttendanceDates | ATT-010 |
| finalizeAvailableDates | ATT-010 |
| fetchData | ATT-001, ATT-010 |
| detectActivityContext | ATT-009, INT-004 |
| enumerateDateRange | ATT-017 |
| getCampDates | ATT-007 |
| autoCarryForward | ATT-007, ATT-008, INT-004 |
| findCarryForwardSourceOnline | ATT-007 |
| findCarryForwardSourceOffline | ATT-008 |
| renderSkeleton / renderSkeletonGroups / renderSkeletonGuests | ATT-001 |
| render | ATT-001, ATT-020 |
| renderCampBanner | ATT-009, INT-004 |
| renderMarkRemainingButton | ATT-006 |
| getUnmarkedParticipantIds | ATT-006 |
| renderDateOptions | ATT-010 |
| renderGroupsAndNames | ATT-001, ATT-012 |
| renderGuests | ATT-011 |
| attachEventListeners | ATT-002, ATT-012, INT-008 |
| toggleGroupSelection | ATT-004 |
| toggleIndividualSelection | ATT-002 |
| updateStatus | ATT-002, ATT-004 |
| updateIndividualStatus | ATT-002, ATT-005, INT-007 |
| updateGroupStatus | ATT-004 |
| markAllRemainingPresent | ATT-006 |
| updateAttendanceDisplay | ATT-002, ATT-005 |
| refreshMarkRemainingButton | ATT-006 |
| changeDate | ATT-010, INT-008 |
| renderError | ATT-020 |
| addGuest | ATT-011 |

### spa/manage_points.js (ManagePoints)
| Method | Stories |
|---|---|
| init | PTS-001, NAV-001 |
| preloadManagePointsData | PTS-001, INT-006 |
| normalizePointsData | PTS-012 |
| applyPointsData | PTS-001 |
| fetchData | PTS-001 |
| loadTodayAttendance | PTS-003 |
| render / renderList / renderGroupedList / renderFlatList | PTS-001, PTS-010 |
| renderUnassignedParticipants | PTS-001 |
| renderParticipantsForGroup / renderParticipantItem | PTS-001 |
| getGroupIndividualTotal | PTS-001 |
| attachEventListeners | PTS-002, INT-008 |
| handleItemClick | PTS-002, PTS-019 |
| applySelection | PTS-019 |
| getEligibleGroupMemberIds | PTS-003, INT-002 |
| applyPointAction | PTS-002, PTS-003, PTS-011, INT-005 |
| selectedElement | PTS-002 |
| flushQueue | PTS-002, PTS-005, PTS-006, INT-005, INT-006 |
| onStoreChange | PTS-002 |
| updateCache | PTS-006, INT-006 |
| showPointChangeAnimation / addHighlightEffect | PTS-002 |
| sortItems | PTS-010 |
| toggleFilter / applyFilter | PTS-010 |
| refreshPointsData | PTS-012, INT-001 |
| organizeParticipants | PTS-001 |
| renderError | PTS-011 |

### spa/modules/points/PointsStore.js (PointsStore)
| Method | Stories |
|---|---|
| load | PTS-001, PTS-007 |
| getParticipantTotal / getGroupTotal / getMembersTotal | PTS-001, PTS-004 |
| applyOptimistic | PTS-002, PTS-004 |
| confirmBatch | PTS-002, PTS-004, PTS-008, INT-002 |
| foldBatch | PTS-006, INT-006 |
| rollbackBatch | PTS-005, INT-007 |
| hasPendingDeltas | PTS-006, PTS-007 |
| subscribe / emit | PTS-009 |
| addDeltas / txnIds / allIds (internal) | PTS-004, PTS-009 |

### spa/manage_honors.js (ManageHonors)
| Method | Stories |
|---|---|
| init / fetchData | HON-001, HON-014 |
| processHonors | HON-001 |
| render / renderHonorsList / renderParticipantItem / getSortIndicator | HON-001 |
| attachEventListeners / attachEventListenersToListItems | HON-001, HON-002 |
| attachHonorActionListeners | HON-008 |
| handleItemClick | HON-001, HON-009 |
| onDateChange / updateHonorsListUI | HON-011 |
| isPastDate | HON-009 |
| awardHonor / showReasonModal / handleReasonSubmit / closeReasonModal / cancelHonorProcess | HON-002 |
| submitHonors | HON-002, HON-003 |
| applyAwardResults / optimisticallyAddHonors | HON-002 |
| clearHonorsCaches | HON-013 |
| sortItems | HON-010 |
| renderError | HON-001 (failure path) |
| showEditReasonModal / showEditDateModal | HON-012 |
| getUndoTimeRemaining / handleUndoHonor / handleDeleteHonor | HON-008 |

### spa/modules/activities/Activities.js (Activities)
| Method | Stories |
|---|---|
| init / loadActivities / render / renderActivityCard | ACT-001, ACT-003 |
| attachEventListeners | ACT-002 |
| deleteActivity | ACT-004 |
| showActivityModal / handleActivitySubmit / showMagicGenerateModal | ACT-007 (catalog-only) |

### spa/modules/OfflineManager.js (offlineManager)
| Method | Stories |
|---|---|
| fetchWithOfflineSupport / handleWriteOperation / queueMutation / storePendingMutation | OFF-001 |
| handleReadOperation / cacheData / getCachedResponse | OFF-004 |
| handleOnline / syncPendingData / replayPendingMutations | OFF-002, OFF-003, INT-006 |
| handleOffline / updateOnlineStatus / dispatchEvent / showToast | OFF-007 |
| enableCampMode / disableCampMode / isDatePrepared / getPreparedActivityForDate / generateDateRange / savePreparedActivities / restoreCampMode / clearPreparedActivities | OFF-005 |

### Backend
| Endpoint / function | Stories |
|---|---|
| GET /v1/attendance | ATT-014, PERM-001 |
| GET /v1/attendance/dates | ATT-013, ACT-006, INT-004 |
| POST /v1/attendance | ATT-003, PERM-002, PERM-003, INT-001 |
| POST /v1/attendance/carry-forward | ATT-015 |
| DELETE /v1/attendance | ATT-016 |
| GET /v1/points | PTS-014 |
| POST /v1/points | PTS-013, PTS-015, PERM-004, INT-002 |
| GET /v1/points/leaderboard | PTS-016 |
| GET /v1/points/report | PTS-017 |
| GET /v1/honors | HON-015 |
| POST /v1/honors | HON-004, HON-005, INT-003 |
| PATCH /v1/honors/:id | HON-006 |
| DELETE /v1/honors/:id | HON-007, INT-003 |
| GET /v1/honors/history | HON-015 |
| GET/POST/PUT/DELETE /v1/activities | ACT-005, ACT-006 |
| utils/api-helpers.calculateAttendancePoints | ATT-003 (both rule shapes) |
| utils/api-helpers.getPointSystemRules | ATT-003, HON-004 (defaults + shapes) |

## Intentionally uncovered (with reasons)

- **Activities.showActivityModal / handleActivitySubmit / showMagicGenerateModal (US-ACT-007)** —
  modal flows depend on `ModalUtils.openModal` and the AI module (`aiGenerateText`); exercising
  them adds heavy mocking for little user-level value beyond ACT-005's server validation.
  Catalog story recorded; implement when the modal utility gets its own suite.
- **OfflineManager.prepareForActivity / transformAttendanceData / preloadCampModules /
  getUpcomingCamps / preCacheCriticalData / getServiceWorkerPendingCount /
  notifyServiceWorkerCampMode / updatePreparationProgress / autoDetectCampMode /
  getCacheDuration / checkPendingMutations / updatePendingCount / getTranslation / init** —
  service-worker-coupled or progress-UI plumbing; the user-observable outcomes (prepared dates,
  queued mutations, replay) are covered by OFF-001..005. Existing
  `test/offline/offline-manager-guards.test.js` covers additional guards.
- **spa/api/api-endpoints.js beyond the attendance/points/honors/groups/participants functions
  exercised here** — the file exports ~100 endpoint wrappers (finance, forms, badges, …); each
  belongs to its own feature's future suite. The cache-invalidation contract for the functions
  in scope is asserted in US-INT-001/003 via `spa/indexedDB.js`.
- **Legacy non-versioned endpoints** (`/api/attendance`, `/api/update-attendance`,
  `/api/award-honor`, `/api/honors-*`, `/api/recent-honors`) — deprecated paths; the SPA calls
  v1. `/api/update-attendance`'s point logic is the same `calculateAttendancePoints` covered by
  ATT-003.
- **Attendance guest backend routes** — `saveGuest`/`getGuestsByDate` live outside
  `routes/attendance.js`; SPA-side behavior covered by ATT-011.
- **jsdom-untestable visuals** — CSS transitions, focus restoration timing, skeleton shimmer.
