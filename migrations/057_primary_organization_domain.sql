-- A unit may answer at several addresses, and names the one its emails use.
--
-- Changing a unit's address must not break what points to the old one: links
-- already emailed, calendar subscriptions, bookmarks and installed apps. So a
-- unit adds an address rather than replacing it, and marks which one emailed
-- links are built from (utils/public-url.js). Until a unit marks one, the
-- oldest exact address is used, as before.

ALTER TABLE public.organization_domains
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.organization_domains.is_primary IS
  'The address emailed links are built from. At most one per unit; without one, the oldest exact address is used.';

CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_one_primary
  ON public.organization_domains (organization_id)
  WHERE is_primary;
