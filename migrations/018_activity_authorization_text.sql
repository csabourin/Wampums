-- The text guardians agree to when they sign an activity's permission slip.
--
-- An activity carries the current wording; each slip keeps the wording it was
-- issued with, so a signature always points at the exact text that was signed.
-- Editing the activity refreshes only slips still awaiting an answer.

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS authorization_text TEXT;

ALTER TABLE public.permission_slips
  ADD COLUMN IF NOT EXISTS authorization_text TEXT;

COMMENT ON COLUMN public.activities.authorization_text IS
  'Authorization wording guardians agree to on this activity''s permission slips';

COMMENT ON COLUMN public.permission_slips.authorization_text IS
  'Authorization wording as issued on this slip; frozen once the slip is answered';
