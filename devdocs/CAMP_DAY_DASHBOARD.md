# Dashboard during a camp

On a camp day the leaders' dashboard follows the camp (`spa/utils/CampDayUtils.js`), decided by dates
only, never by a name: today's programme of a planned camp (`GET /api/v1/meetings/programme`,
`kind: 'camp'`), else an activity with `is_camp` covering today, else the camp prepared on the device
for today. "Give points" leads all day; attendance is offered as the morning roll call
(`CONFIG.DASHBOARD.CAMP_ROLL_CALL_UNTIL_HOUR`) until today's attendance exists; welcoming a new child
and the meetings screen leave "now", reporting an incident joins it. The card says "{camp} — day N of
M" and what is on now and next (the programme bar's calculation, `ProgrammeTimeline.js`); a schedule
the device could not read is said so, and only `meetings.view` holders (the programme's permission)
see a schedule. A minute clock redraws the schedule in place and the dashboard at the roll-call cutoff
or a new day. The "At camp" shortcuts are declared in `CAMP_DAY_SHORTCUTS`
(`spa/config/dashboard-tiles.js`): readiness, site and emergencies, the caller's equipment lots and
departures, each through the tiles' visibility (gate, unit-hidden `featureKey`, person-hidden tiles;
pages that need the network are not offered offline). Medication is promoted when a dose is near during a camp
day or an activity under way by its dates and times. Tests: `test/spa/DashboardCampDay.test.js`, and in a real browser `e2e/accessibility.spec.mjs` ("the leaders' dashboard at camp and on an outing", on the seeded autumn camp's first evening, `campStartDate`).

An outing that replaces today's meeting is followed the same way, with the differences listed in
`MEETING_REPLACEMENT.md`.

The site and emergencies shortcut stays offered offline: that page is kept on the device (`devdocs/CAMP_SITES.md`).
