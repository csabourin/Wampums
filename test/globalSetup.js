/**
 * Jest global setup: runs once, before the test workers start.
 *
 * Tests run in the units' own time zone. CI machines are in UTC, where local
 * time and UTC agree, so a date taken from the wrong one would pass unnoticed;
 * here a dose at 20:00 is 01:00 UTC the next day. Workers inherit the variable,
 * which a test file cannot set for itself (Jest gives each file a copy of
 * process.env).
 *
 * @returns {void}
 */
module.exports = () => {
  process.env.TZ = 'America/Toronto';
};
