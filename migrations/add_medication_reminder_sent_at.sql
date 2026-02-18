-- Add reminder_sent_at column to medication_distributions
-- Tracks when a push notification reminder was sent so the scheduler
-- can avoid sending duplicate reminders for the same distribution.

ALTER TABLE medication_distributions
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_medication_distributions_reminder
  ON medication_distributions (organization_id, scheduled_for, status, reminder_sent_at)
  WHERE status = 'scheduled' AND reminder_sent_at IS NULL;
