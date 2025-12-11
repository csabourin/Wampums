-- Improve permission slips for better UX
-- Adds activity details, email tracking, and deadline support

-- Add new columns to permission_slips table
ALTER TABLE public.permission_slips
  ADD COLUMN IF NOT EXISTS activity_title VARCHAR(200),
  ADD COLUMN IF NOT EXISTS activity_description TEXT,
  ADD COLUMN IF NOT EXISTS deadline_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITH TIME ZONE;

-- Create index for email tracking queries
CREATE INDEX IF NOT EXISTS idx_permission_slips_email_tracking
  ON public.permission_slips(organization_id, meeting_date, email_sent, status)
  WHERE status = 'pending';

-- Create index for deadline queries
CREATE INDEX IF NOT EXISTS idx_permission_slips_deadline
  ON public.permission_slips(organization_id, deadline_date)
  WHERE deadline_date IS NOT NULL AND status = 'pending';

-- Add comment for documentation
COMMENT ON COLUMN public.permission_slips.activity_title IS 'Title of the activity requiring permission';
COMMENT ON COLUMN public.permission_slips.activity_description IS 'Rich text description of the activity (supports HTML from WYSIWYG editor)';
COMMENT ON COLUMN public.permission_slips.deadline_date IS 'Deadline for parent to sign the permission slip';
COMMENT ON COLUMN public.permission_slips.email_sent IS 'Whether notification email has been sent to parent';
COMMENT ON COLUMN public.permission_slips.email_sent_at IS 'Timestamp when notification email was sent';
COMMENT ON COLUMN public.permission_slips.reminder_sent IS 'Whether reminder email has been sent';
COMMENT ON COLUMN public.permission_slips.reminder_sent_at IS 'Timestamp when reminder email was sent';
