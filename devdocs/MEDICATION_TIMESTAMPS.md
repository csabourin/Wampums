# Medication distribution timestamps

`POST /api/v1/medication/distributions` requires `scheduled_for` to identify an
instant. `PATCH /api/v1/medication/distributions/:id` applies the same validation
to `administered_at` when supplied; omission or `null` retains its existing
optional behaviour.

Both fields accept a calendar date and time in the form
`YYYY-MM-DDTHH:mm[:ss[.SSS]]Z` or with a signed `HH:mm` UTC offset in place of `Z`.
Fractional seconds may have one to three digits. For example,
`2026-01-15T08:00:00-05:00` is stored as `2026-01-15T13:00:00.000Z`.

The API returns HTTP 400 before reading or writing medication records for a
missing required time, an impossible date, or a time without an explicit offset.
It never guesses the unit's or the server's time zone. Date-only values, numeric
epochs, informal date strings and `24:00` are rejected. Existing stored doses are
not changed.

The web scheduling form converts the leader's local date and time to an instant
with `toISOString()` before sending it. Administration actions in the web and
legacy mobile clients already use `toISOString()`. The frozen legacy mobile
scheduling form sends free text: callers must enter an explicit offset or `Z`;
an offset-free value now receives 400 instead of being silently interpreted in
the server's zone. No mobile code is changed.

During the repeated hour at the end of daylight saving time, callers must choose
the offset: `2026-11-01T01:30:00-04:00` and
`2026-11-01T01:30:00-05:00` are different instants. The client remains responsible
for choosing the intended zone and offset; the API does not infer an IANA zone
from an offset.

Regression coverage: `test/medication-timestamps.test.js` exercises both routes,
UTC storage and the duplicate-dose comparison. The existing
`test/spa/MedicationScheduleTimeZone.test.js` verifies local-to-UTC conversion in
the web form. No screen, permission, schema or medication dosage rule changes.
