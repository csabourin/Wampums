-- Consecutive failed pushes per device.
--
-- A device was deleted only when the push service said it was gone (404/410)
-- or bound to another key (401/403). A device failing any other way (a
-- malformed answer, a network error, a 400 or 5xx) stayed on file and failed
-- at every send: an announcement to two people kept reporting nine failed
-- pushes. Each send now counts the failures of every device and resets the
-- count when one is delivered; a device that fails three sends in a row,
-- while the same sends reached other devices, is deleted.

ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.subscribers.failure_count IS
  'Sends in a row this device failed while the same send reached other devices; reset on delivery. The device is deleted at 3.';
