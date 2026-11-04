# Reusing an earlier camp

Issue #1256. From a camp's schedule (yearly planner › camp › schedule), a leader opens
**Reuse an earlier camp**, picks one of the unit's earlier camps, ticks what to bring over,
and copies it into the camp being prepared.

## What is copied

| Part | Copied | Reset or left out |
|---|---|---|
| `site` | The site chosen (#1317), season, accommodation, contact number | The unit lead on site, chosen again for each camp. An archived site is not chosen again (`site_unavailable`). |
| `schedule` | Day headings and lines after the first day, with catalogue articles still active (as the older "copy schedule" did) | Day zero, which belongs to meeting preparation |
| `packing_list` | The personal packing list's settings, notes, active items and translations | Copied **unpublished and unreviewed**; families see nothing until the team publishes it. An item's link to an archived article is dropped, its text kept. |
| `lots` | Each equipment lot, its articles and duties | State `to_prepare`, version 1, one `created` history entry. An article missing from the new camp's material list is left out; no lot takes more than the list holds; a lot left with nothing is reported in `skipped_lots`. Duties fall on the new camp's first day (return: last day). |
| `tasks` | The camp's own tasks, on its date or its activity, and their material reminders | Status `todo`; due date shifted by the number of days between the two camps' starts; a reminder waits to be sent again. Lot duties travel with their lot, not here. |
| `plan` | The camp's own written plan sections (#1318: V.C.P.R.E.F., theme, motivation) and its games for bad weather still in the library | Sections copied as drafts to reread. Rules and emergency sections are not copied: the new camp follows the unit's current templates. |

Nothing that belonged to the earlier stay or to a person is copied: registrations, invitations,
authorizations, attendance, family packing checks (they never reach the server), lot and task
progress and history, volunteer shifts and signups.

A duty or task held by someone no longer active in the unit goes to the person copying; the
answer counts them in `reassigned_tasks` and the dialog asks to reassign them.

## Rules

- `GET /api/v1/yearly-planner/meetings/:id/duplication` (`meetings.manage`): the target camp with
  what it holds (`counts`), and up to 20 earlier camps of the unit that hold something, latest first,
  with `fits_schedule`.
- `POST /api/v1/yearly-planner/meetings/:id/duplicate` with `{ source_meeting_id, parts }`
  (`blockDemoRoles`). Each part takes the rights its own screen requires
  (`config/camp_duplication.json`, read by the server and the SPA): `meetings.manage` always (enough for the site and the schedule), plus
  `personal_equipment.manage` for the packing list, `camp_lots.view` + `camp_lots.manage` +
  `tasks.manage` for lots, `tasks.view` + `tasks.manage` for tasks; the plan needs `meetings.manage` only. A missing right answers 403 with
  `required` and `missing`.
- Every part chosen is copied in one transaction (`services/campDuplication.js`), or none is. The
  target camp's row is locked first, so two leaders copying at once produce one copy.
- A part already filled in the target is refused (409 `camp_duplicate_target_not_empty`, `errors`
  naming the parts): nothing is replaced or doubled. A schedule longer than the target answers 409
  `camp_duplicate_too_short` with `dropped_days`. A cancelled target answers 409.
- Source and target must be camps (`meeting_kind = 'camp'`) of the authenticated unit (404 otherwise).
- The copy requires a connection; it is never queued for replay.

Tests: `test/camp-duplication.integration.test.js` (the copy on a real database),
`test/routes-camp-duplication.test.js` (who may copy what), `test/spa/CampDuplication.test.js`
(the dialog, with axe and keyboard checks).

## Rules summary

The binding rules for this area, formerly in CLAUDE.md.

The camp schedule offers "Reuse an earlier camp" (`services/campDuplication.js`,
`POST /api/v1/yearly-planner/meetings/:id/duplicate`). It copies the parts chosen (site, schedule
after day zero, personal packing list, equipment lots, the camp's own tasks) in one transaction, with the
target camp locked; a part already filled in the target is refused, never merged. Dates shift by the
gap between the two camps; lots return to `to_prepare`, tasks to `todo`, the packing list to an
unpublished draft. Nothing personal is copied (registrations, authorizations, checks, progress,
volunteer signups). Each part takes its own screen's rights (`config/camp_duplication.json`, shared
with the SPA); a duty held by someone no longer active goes to the person copying. See
`devdocs/CAMP_DUPLICATION.md`.
