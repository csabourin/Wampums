/** Shared task states and validation limits. Add usage-specific states here. */
module.exports = {
  EQUIPMENT_REMINDERS: {
    TIME_ZONE: process.env.EQUIPMENT_REMINDER_TIME_ZONE || 'America/Toronto',
    POLL_MS: 60_000, BATCH_SIZE: 50, MATERIALS_MAX_LENGTH: 5000,
    MAX_LEAD_DAYS: 30, MIN_REPEAT_HOURS: 24, MAX_REPEAT_HOURS: 168,
    DEFAULT_LEAD_DAYS: 2, DEFAULT_REPEAT_HOURS: 24,
    LOCK_KEY: 7246648,
  },
  /** Automatic emails about assigned tasks (services/taskReminders.js). */
  TASK_REMINDERS: {
    SETTING_KEY: 'task_email_reminders',
    /** Days before the due date of the first reminder; the second is sent on the due date. */
    LEAD_DAYS: 2,
    /** Due reminders leave from this local hour on, never during the night. */
    SEND_HOUR: 7,
    POLL_MS: 60_000, BATCH_SIZE: 200,
    LOCK_KEY: 7246649,
  },
  TASK_STATUSES: ['todo', 'in_progress', 'done'],
  TASK_TITLE_MAX_LENGTH: 255,
};
