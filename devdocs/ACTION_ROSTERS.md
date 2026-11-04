# Action rosters during activities

Attendance, points and honors share `ActionRoster` and `/api/v1/action-roster`.
An activity with issued permission requests defaults to its signed participants;
an activity without permission requests offers the whole unit. Once attendance
exists for the day, points and honors show only present/late participants still
on site. Attendance keeps the eligible roster visible so late arrivals can be
marked. A planned meeting defaults to the whole unit in attendance. The explicit
meeting/activity selector resolves overlapping dates; its choice follows navigation.
“Show all participants” is an explicit exception for that screen, reset on a context
change. Group and individual awards send that scope and the server enforces it.
Unit enrollment checks always apply, including with an exception.

Attendance remains daily, shared by the unit: an activity selector filters the
roster; it does not create a second attendance register for the same day.
`POST /api/v1/attendance/departure` sets `is_on_site = false` while retaining the
recorded status and earned points. Marking present/late again clears the departure.
Departures do not carry forward to the next camp day. Attendance writes keep their
outbox order across reconnections. Camp preparation caches the authorization and
roster snapshots as well as attendance; local unsent arrivals/departures overlay
them when another action screen opens offline. Apply migration 045 before the client.
