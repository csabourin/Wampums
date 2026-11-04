# An outing that replaces a meeting

Issue #1327. A one-day outing (not a camp) on the date of a regular or special meeting, inviting
everyone, replaces that meeting (`services/meetingReplacement.js`).

## Rules summary

- **"Everyone" follows the action rosters** (`devdocs/ACTION_ROSTERS.md`): an outing without permission
  requests concerns the whole unit; one with permission requests replaces the meeting only once every
  active enrollment of the active scout year has received one (a declined request counts: it was
  received). An outing that invites only some youths, a camp, or an outing of several days never
  replaces a meeting. Another unit's outing never replaces this unit's meeting.
- **Worked out on every read, never stored**, so it follows the outing's dates and permission requests as
  they change. No migration.
- **The planner keeps the meeting**, marked "replaced by {outing}" (`replaced_by_activity_id`,
  `replaced_by_activity_name` on `GET /api/v1/yearly-planner/plans/:id`), with its schedule lines and
  tasks. The chip says "Replaced" in words; its description and the sheet name the outing.
- **The day follows the outing:** the day programme (`GET /api/v1/meetings/programme`),
  `GET /api/v1/meetings/next` and the action roster's `meeting_dates` skip the replaced meeting
  (the next meeting is found past any number of replaced dates). The roster's `replacing_activities`
  (`{ date: activityId }`) makes the outing the day's default activity even beside another activity,
  so its permission requests filter the roster. Activities carry `replaces_meeting_id` /
  `replaces_meeting_date` (list and single read).
- **Dashboard:** that outing is followed as a camp day is (`devdocs/CAMP_DAY_DASHBOARD.md`,
  `outingDayFromActivities`): points lead; the roll call is offered at any hour until taken; departure
  and return times and places are shown; only the departures shortcut (`kinds` in `CAMP_DAY_SHORTCUTS`).
- **Deleting the outing** asks (`askRestoreReplacedMeeting`, `DialogUtils.confirm`) whether the meeting
  comes back. Yes, or a DELETE without `restore_meeting`, leaves it uncancelled; declining (or dismissing)
  sends `restore_meeting=false`, which marks the meeting cancelled in the outing's own deletion
  transaction. Keeping it cancelled takes `meetings.edit` as well as `activities.delete` (the planner's
  right to cancel a meeting); without it the question is not asked and the meeting comes back. The replacement is worked out before the pending permission requests are archived. The
  answer's `replaced_meeting` says what became of it.

Tests: `test/meeting-replacement.integration.test.js`, `test/spa/DashboardCampDay.test.js`,
`test/spa/ActivityDeleteDialog.test.js`, `test/spa/MeetingSheet.test.js`,
`test/spa/YearlyPlannerReplacedMeeting.test.js`.
