/** Shared task states and validation limits. Add usage-specific states here. */
module.exports = {
  EQUIPMENT_REMINDERS: {
    TIME_ZONE: process.env.EQUIPMENT_REMINDER_TIME_ZONE || 'America/Toronto',
    POLL_MS: 60_000, BATCH_SIZE: 50, MATERIALS_MAX_LENGTH: 5000,
    MAX_LEAD_DAYS: 30, MIN_REPEAT_HOURS: 24, MAX_REPEAT_HOURS: 168,
    DEFAULT_LEAD_DAYS: 2, DEFAULT_REPEAT_HOURS: 24,
    LOCK_KEY: 7246648,
  },
  TASK_STATUSES: ['todo', 'in_progress', 'done'],
  TASK_TITLE_MAX_LENGTH: 255,
};
