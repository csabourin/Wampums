/**
 * Jest global setup: runs once, before the test workers start.
 *
 * Tests run in the units' own time zone. CI machines are in UTC, where local
 * time and UTC agree, so a date taken from the wrong one would pass unnoticed;
 * here a dose at 20:00 is 01:00 UTC the next day. Workers inherit the variable,
 * which a test file cannot set for itself (Jest gives each file a copy of
 * process.env).
 *
 * The database sessions of the integration suites keep that zone too, as a
 * developer's local PostgreSQL does: their fixtures say `CURRENT_DATE + 3`, and
 * the application now reads the day where the unit is (`unit_today`, default
 * America/Toronto). On a UTC session the two would disagree every evening.
 * `test/unit-clock.integration.test.js` covers units in other zones.
 *
 * @returns {void}
 */
module.exports = () => {
  process.env.TZ = 'America/Toronto';
  process.env.PGOPTIONS = process.env.PGOPTIONS || '-c TimeZone=America/Toronto';
};
