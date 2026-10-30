# Ready for camp (#1250)

The camp schedule, the camp's material list, its activity card (when the outing is linked to a
planner camp, `linked_year_plan_meeting_kind = 'camp'`) and the dashboard open
`/camp-readiness/:meetingId`. A camp created only as an activity (an active activity whose last day
follows its first, not scheduled as a planner camp) opens `/camp-readiness/activity-:activityId`
from its activity card and the dashboard; `GET /api/v1/camp-readiness/activities/:id` answers with
the planner camp when one links the activity, and otherwise returns `camp.id = null`,
`camp.scheduled = false` and only the tasks and consent sections, since collective material and
equipment lots are listed from a planner camp's schedule. The screen says so. A one-day outing or a
removed activity is 404.

The dashboard lists camps under way or starting within 14 days (at most three) from
`GET /api/v1/camp-readiness/upcoming`, which requires the same `meetings.view` and organization
scope: planner camps, then activity-only camps (each camp once; an activity linked to a planner camp
is listed as that camp). It shows nothing when no camp is near or the list cannot be read.

The activity card's device check ("Vérifier la disponibilité hors ligne") and device status appear
only while this device would prepare the camp (`isCampPreparationWindow`: from
`OFFLINE_CAMPS.LOOKAHEAD_DAYS` before its first day until its last), not on camps months away.

The screen opens on "What is left": one line per section the person may see, saying what remains
(pending consent, articles to reserve or find, free-text notes, lots to prepare, open and overdue
tasks). An empty section reads "nothing recorded yet", never as done. Each row then names its state
in a chip, and an item past its date says it is late in words. The way back leads to the camp's
year plan. This is team preparation,
separate from `CampPreparation`, which verifies offline readiness of one device.
No overall green readiness flag is inferred from empty lists or invisible sections.

`GET /api/v1/camp-readiness/:id` requires `meetings.view` and organization data
scope. The camp must be a planned meeting of kind `camp` in the authenticated unit.
It returns a fresh summary assembled from existing resources:

- Collective material: `meetings.view`. Inventory comparison additionally requires
  `inventory.view`; otherwise quantities available/reserved/missing are not loaded.
  Unconsolidated free text remains a visible warning to check the collective list.
- Lots and duty owners/deadlines: `camp_lots.view`.
- Unit tasks for the planned camp or its linked outing: `tasks.view` and
  `tasks.manage`, matching the task screen. The action link filters that screen.
- Issued permission counts and earliest deadline by status: `activities.view`,
  `participants.view`, `groups.view`, matching the consent dashboard. An unlinked
  camp has no consent section. No access tokens or signatures are returned.

All conditional rights come from the shared authorization engine, never query
parameters or JWT snapshots. Unknown/foreign camps return 404. Cancelled camps are
explicitly identified. Errors offer a retry, never a successful empty overview.

There is no camp-specific charge/payment model in the current schema: annual unit
fees cannot honestly stand for camp payments. That section is absent until such a
model exists. Structured volunteer slots (#1251) do not exist yet either, so their
section is absent. Existing assigned tasks are shown as tasks. No new permission or
migration is needed: this read-only composition uses the existing resource rights.

English/French labels, jsdom/axe, route permission tests, a migrated-PostgreSQL
isolation test and the seeded phone/desktop accessibility suite cover this screen.
Material quantities retain the article's unit of measure and the interface's number
format (for example, `2,5 kg` in French). Consent totals are localized counts with
no equipment unit.
Consent deadlines are stored as `timestamptz` and serialized as ISO UTC instants,
including when the database session uses another time zone. Calendar-only dates
remain `YYYY-MM-DD` strings.
