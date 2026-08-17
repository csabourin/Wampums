-- Membership reactivation requests
--
-- A family whose last child left is deactivated by the year transition. That is
-- routine, and a returning family may undo it themselves. A membership an admin
-- deactivated by hand is a different matter: it may have been removed for cause,
-- so its return is an admin's decision, not the member's.
--
-- This column is what separates "asked to come back" from "came back". It is set
-- only on the second path, and it is what an admin's pending-requests list reads.

ALTER TABLE public.user_organizations
  ADD COLUMN IF NOT EXISTS reactivation_requested_at timestamp with time zone;

COMMENT ON COLUMN public.user_organizations.reactivation_requested_at IS
  'Set when a deactivated member confirmed an emailed reactivation link that needs an admin decision. Cleared whenever the membership becomes active again.';

-- Pending requests are a small slice of a large table, and the admin queue is the
-- only reader. A partial index keeps that lookup off a sequential scan.
CREATE INDEX IF NOT EXISTS idx_user_organizations_reactivation_pending
  ON public.user_organizations (organization_id)
  WHERE reactivation_requested_at IS NOT NULL;
