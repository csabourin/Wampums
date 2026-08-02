# Yearly Planner — what is left

Status as of 2026-08-01, branch `fix/yearly-planner-cache-invalidation` (8 commits on top of `main`).

Shipped so far: cache invalidation fix, `meeting_kind` + camp-day migrations, one-off/weekend/camp dates,
delete + unlink, the year-at-a-glance view, the meeting sheet, series placement, and the fix that stopped a
preparation save from destroying planner data. 1105 tests, 6 lints, production build clean.

Nothing below is started. Items 1–3 are blocking; everything after is feature work.

---

## 1. Apply the two migrations — BLOCKING, do this first

**The migrations have never been run anywhere.** They were only ever validated inside transactions that
were rolled back, so neither the local dev database nor production has the new columns. The shipped code
reads them, so **it will 500 on any database that has not been migrated**:

- `GET /plans/:id` selects `m.meeting_kind` (`routes/yearlyPlanner.js`)
- `POST /plans/:planId/meetings` inserts `meeting_kind`
- `POST .../batch-activity` and the preparation reconcile both filter on `day_offset`

Files, in order:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/add_year_plan_meeting_kind.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/add_camp_day_schedule.sql
```

Both are idempotent and wrapped in `BEGIN/COMMIT`. Verify:

```sql
SELECT column_name FROM information_schema.columns
 WHERE (table_name='year_plan_meetings'            AND column_name='meeting_kind')
    OR (table_name='year_plan_meeting_activities'  AND column_name='day_offset');
SELECT to_regclass('year_plan_meeting_days');
SELECT meeting_kind, count(*) FROM year_plan_meetings GROUP BY 1;
```

Local dev database is the `wampums-pg` docker container (`docker exec -i wampums-pg psql -U postgres -d wampums`).
Production is on Railway; reach it through the Railway CLI — the `DATABASE_URL` in `.env` is stale.

**Acceptance:** the three checks above return the columns/table, and the `meeting_kind` histogram shows
`camp`/`weekend` rows where outings already exist.

---

## 2. Remove the orphaned meeting-detail view

Replacing the timeline with the year grid left the old detail screen unreachable: nothing assigns
`this.view = VIEW.MEETING_DETAIL` any more, but the enum member, the `switch` case and
`renderMeetingDetail()` (81 lines, `spa/modules/yearly-planner/YearlyPlanner.js:796–876`) all remain, along
with whatever modals only it opened.

This is dead code I introduced; it should not survive review.

**How:**
1. Delete `VIEW.MEETING_DETAIL`, its `case` in `render()`, and `renderMeetingDetail()`.
2. Walk what it alone referenced — `showAddActivityModal`, `showCreateEventModal`, `showMeetingEditModal`,
   `this.currentMeeting`, and the `yp-back-to-plan` / `yp-add-activity-btn` / `yp-create-event-btn`
   listeners — and delete anything with no remaining caller. Re-run the dead-method scan:
   ```bash
   grep -c "this\.<name>" spa/modules/yearly-planner/YearlyPlanner.js
   ```
3. Anything genuinely still wanted (adding a single activity to one evening, creating an outing from a
   meeting) belongs in `MeetingSheet.js`, not in a second full-page view. Decide per feature; do not port
   the page.
4. Drop the i18n keys orphaned by the timeline removal, from **both** `lang/en.json` and `lang/fr.json`:
   `yearly_planner_no_meetings`, `yearly_planner_outing`, `yearly_planner_unassigned`, and the
   pre-existing `yearly_planner_nav`. Keep `yearly_planner_empty` — it is used through a dynamic
   `translate()` call and the static scan reports it as a false positive.

**Acceptance:** `YearlyPlanner.js` drops well below 1699 lines, `npm run lint:i18n-parity` passes, full
suite green, and the year view still opens a date.

---

## 3. Look at it in a browser

Nothing in this feature has ever been rendered on screen. Everything is verified by tests, a real
Postgres and a production build — which does not tell you whether the layout works.

```bash
npm run dev     # Vite, port 5173
npm start       # API, port 5000
```

Check, in this order:
- **Desktop band alignment.** `.yp-month__chips` and `.yp-month__bands` share one
  `grid-template-columns: repeat(var(--chip-count), …)`. If a band is off by a column, the bug is
  `--band-start` (1-based) versus `chip.startIndex` (0-based) in `YearGridView.renderPeriodBands`.
- **Camp chips.** `.yp-chip-slot--span` sets `grid-column: span 2`; with several camps in one month the
  track may overflow. Consider `minmax(7rem, 1fr)` tuning.
- **Mobile.** Bands are deliberately hidden below 700px and the period shows as a leading edge on each
  chip — but `--chip-band-color` is **never set anywhere**, so that edge is currently transparent. Either
  set it per chip from `chip.periodId` in `renderDateChip`, or drop the rule.
- **Arm bar.** It is `position: sticky; top: .5rem` inside a scrolling page; confirm it does not collide
  with the app header.
- Then a keyboard-only pass: Tab to a chip, Enter to open the sheet, arm a placement, Tab/Enter to select
  several dates, Escape to abandon.

**Acceptance:** a screenshot of a real plan on both widths, and the keyboard pass completed without a mouse.

---

## 4. Finish the loose ends from Phase 4

Small, and each leaves a visible half-feature today.

### 4a. Series are placeable but not removable
`deleteSeries()` exists in `spa/api/api-yearly-planner.js` and `DELETE /v1/yearly-planner/series/:seriesId`
works, but **nothing in the UI calls either**, and `yearly_planner_series_removed` is an unused key.

**How:** the model already carries `chip.seriesIds`, and each placed row has
`metadata.series_label` / `metadata.series_total`. In `MeetingSheet.js`, render a "Series" block listing
this date's series with its occurrence ("Préparation du camp 2 / 4") and a remove button calling
`deleteSeries(id)`, with `confirmDestructive` warning that it removes the segment from **every** date.
To show the label you need the occurrence on the chip: extend the meetings query in `GET /plans/:id` to
aggregate `series_id`, `series_occurrence` and `metadata->>'series_label'` per meeting instead of just the
id array.

### 4b. The back-link from preparation goes nowhere
`MeetingSheet` navigates to `/preparation-reunions/:date?from=plan:<id>`, but **`MeetingPrep.js` never
reads the query string**, so the round trip drops the user on the plan list.

**How:** in `MeetingPrep.init()`, parse `from` (`new URLSearchParams(window.location.search)`), keep it on
the instance, and make the existing `open_yearly_planner` link (`MeetingPrep.js:487`) navigate back to
`/yearly-planner` with the plan preselected. That needs the planner to accept a deep-linked plan — add a
`/yearly-planner/:planId` route in `spa/router.js` (lazy map ~line 128, routes ~line 225, switch ~line 633)
that calls `loadPlanDetail(planId)` directly.

### 4c. `PATCH /v1/yearly-planner/series/:seriesId`
Renaming or retiming a whole series currently means deleting and re-placing it. Mirror the DELETE route:
same permission (`meetings.manage`), same `matches(/^[A-Za-z0-9-]+$/)` validation, `UPDATE … SET name,
duration_minutes, description … WHERE series_id = $1 AND organization_id = $2`. Do **not** let it touch
`series_occurrence` — that is derived from date order and belongs to the server.

---

## 5. Camp schedule editor

The reason this matters: a summer camp is 8 days × ~15 timed lines, it is planned months after the date is
placed, and it is largely the same shape every year.

**The data model is ready and verified** — a real 8-day schedule round-trips through it:
- `year_plan_meeting_activities.day_offset` — 0 = the meeting's own date
- `year_plan_meeting_days (meeting_id, day_offset, title, notes)` — the per-day heading
  ("L'Appel des cordes brisées")
- The existing columns already carry heure / activité / responsable / matériel:
  `start_time`, `name`, `responsable`, `material`, `description`, `sort_order`

**What is missing is all of the routes and all of the UI.**

### 5a. Routes (`routes/yearlyPlanner.js`)
- `GET /v1/yearly-planner/meetings/:id/schedule` — days plus their activities, grouped by `day_offset`,
  each day resolved to a real date (`meeting_date + day_offset`). Permission `meetings.view`.
- `PUT /v1/yearly-planner/meetings/:id/days/:dayOffset` — upsert a day's title and notes.
- `POST|PATCH|DELETE` on the day's activities. **Reuse the existing meeting-activity routes** by accepting
  `day_offset` in the body rather than adding a parallel set: `POST /meetings/:meetingId/activities`
  already inserts a timeline row, and only needs the column threaded through.
- Validate `day_offset` against the linked activity's span, so a 3-day camp cannot hold a day 7.

### 5b. UI (`spa/modules/yearly-planner/CampSchedule.js`)
Reached from `MeetingSheet` when `chip.spanDays > 1` ("Horaire du camp"). Day navigation as a horizontal
strip of buttons (`Sam 11 · Dim 12 · …`) rather than tabs, so 8 days fit on a phone. Within a day, reuse
the interaction patterns of `spa/modules/ActivityManager.js` — cascading times, insert-between dividers,
quick edit — but read them; do not import that class, it is bound to the prep form's DOM.

Mobile: one card per line (heure, activité, responsable, matériel), not a 4-column table.

### 5c. Copy last year's camp
The highest-value part, and the reason the model was built this way.
`POST /v1/yearly-planner/meetings/:id/schedule/copy-from/:sourceMeetingId` — copy every
`year_plan_meeting_days` row and every `day_offset > 0` activity from the source, shifting nothing but the
meeting id. Refuse when the target span is shorter than the source; report which days were dropped.
Offer it in the sheet when the meeting is a camp and its schedule is empty.

**Acceptance:** paste the 2026 camp schedule in, navigate all 8 days, reopen from the year view and see it
intact; then copy it onto a 2027 camp.

---

## 6. Period colours and editing

`PlannerModel.periodColor()` reads `period.settings.color` and validates it as a hex value, falling back
to a six-colour palette. **Nothing writes it** — there is no colour picker anywhere, so every band uses a
fallback.

**How:** `spa/modules/yearly-planner/PeriodEditor.js`, opened from the existing Periods tab. Title, start,
end, and a small swatch row (the six `PERIOD_FALLBACK_COLORS` plus a native `<input type="color">`).
`PATCH /v1/yearly-planner/periods/:id` already accepts `settings`, so this is client-only — but **read the
existing settings and merge**, since that column also holds anything else a period carries.

Keep the hex validation in `periodColor()`. It exists because `settings` is user-controlled JSON and the
value lands in a `style` attribute.

---

## 7. Objectives on the year view

`year_plan_objectives` and `year_plan_meeting_activities.objective_ids` both exist and are populated by
the batch placement path; nothing displays them.

**How:** add an objective count per chip in the model (`chip.objectiveIds`, from the meetings query), and
show progress on the Objectives tab: for each objective, how many meetings carry it and how many
participants have it in `objective_achievements`. The achievements routes
(`GET|POST /achievements`, `DELETE /achievements/:id`) are fully built and completely unreachable from the
SPA — wire those before writing anything new.

---

## 8. Backend that exists but has no UI at all

Verified present in `routes/yearlyPlanner.js`, unreachable from the SPA. Each is a small, self-contained
feature.

| Feature | Endpoints | Notes |
|---|---|---|
| Distribution rules | `GET/POST /plans/:planId/distribution-rules`, `DELETE /distribution-rules/:id` | "This activity N times per period, evenly spaced." Would auto-generate a series — build **after** series editing, since it produces them. |
| Achievements | `GET/POST /achievements`, `DELETE /achievements/:id` | Per-participant objective completion. |
| Reminders | `POST /meetings/:meetingId/reminders`, `GET /plans/:planId/reminders` | `MeetingPrep` has its own reminder form; unify rather than adding a second one. |
| Blackout dates / anchors | `year_plans.blackout_dates`, `.anchors` (jsonb) | Consumed by `generateMeetingDates()` at plan creation, never editable afterwards. Editing them should regenerate — decide what happens to dates already prepared. |

---

## 9. Smaller items

- **Back-link from `Activities.js`.** Show "Planifiée le … · Voir dans le planificateur" on an outing that
  came from a meeting. Needs `linked_year_plan_meeting_id` on `GET /v1/activities` —
  `LEFT JOIN year_plan_meetings ypm ON ypm.activity_id = a.id`, mirroring what `GET /plans/:id` already does.
- **Print / export the year plan.** Asked for by leaders every autumn. `css/yearly-planner.css` has one
  `@media print` rule (`break-inside: avoid` on chips) and nothing else.
- **`year_plans` has no `scout_year_id`.** Plans are not archived or rolled over by
  `services/scoutYear.js`; they accumulate, filtered only by `is_active`. Decide whether a plan belongs to
  a scout year before there are several years of them.
- **`meetings.create` / `meetings.edit` / `meetings.delete`** exist in the permissions table and are never
  checked — everything uses `meetings.view` / `meetings.manage`. Either use them or drop them.

---

## Conventions for anything above

- New endpoints under `/api/v1/`, registered in `routes/index.js`; `authenticate` + `requirePermission` +
  `blockDemoRoles` on writes; `success`/`error`/`asyncHandler` from `middleware/response.js`; every query
  filtered by `organization_id` from `getOrganizationId(req, pool)`, never from a header.
- Parameterized SQL only. For dynamic updates follow the whitelist pattern now in `PATCH /meetings/:id`:
  build the `SET` clause from a fixed column list so a request can never name its own column.
- SPA modules extend `BaseModule`; `setContent` not `innerHTML`; `escapeHTML` every interpolation;
  `debugLog`/`debugError` not `console`; `app.showMessage` for toasts (there is no `ToastUtils.js`).
- Every mutating export in `spa/api/api-yearly-planner.js` must call `invalidatePlanner(...)`.
  `test/spa/YearlyPlannerCache.test.js` is table-driven and **will fail** if you add one without it — that
  is deliberate, it is the regression that made the whole feature look broken.
- Keys in **both** `lang/en.json` and `lang/fr.json`. No month-name keys: use
  `formatDate(date, lang, { month: 'long', year: 'numeric' })`.
- Date arithmetic goes in `PlannerModel.js` and parses `YYYY-MM-DD` as local midnight. Never
  `new Date('2025-09-10')` — it parses as UTC and lands on the 9th west of Greenwich. The model suite is
  run under five timezones for this reason.

## Testing expectation

Route tests follow `test/routes-yearly-planner.test.js` (mocked `pg`, supertest, org-scoping asserted on
every lookup). SPA tests follow `test/spa/YearlyPlannerModel.test.js` (pure) and
`test/spa/YearlyPlannerGrid.test.js` (jsdom).

**Write the test so that it fails when the fix is reverted, then check that it does.** Every guard in this
feature was mutation-checked that way, and it caught a test in this very suite that was passing for the
wrong reason: the batch verification rows were stubbed already in date order, so the route's chronological
sort was never exercised. Deleting the sort changed nothing until the stub was shuffled.
