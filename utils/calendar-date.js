'use strict';

/** Validate a date-only value without allowing JavaScript to roll impossible dates forward. */
function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {return false;}
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${value}T`);
}

module.exports = { isCalendarDate };
