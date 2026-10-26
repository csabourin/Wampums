-- A domain names one unit.
--
-- Sign-in, public pages and emailed links find the unit from the address the
-- request was sent to (organization_domains). Nothing stopped two units from
-- holding the same domain, and the lookup then answered whichever row came
-- first. Creating a unit now records its subdomain, so the address must be
-- unique, compared without case as hostnames are.
--
-- A domain held twice was already ambiguous: the oldest row, which the lookup
-- most often returned, is kept.

DELETE FROM public.organization_domains duplicate
 USING public.organization_domains original
 WHERE lower(duplicate.domain) = lower(original.domain)
   AND duplicate.id > original.id;

CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_domain_unique
  ON public.organization_domains (lower(domain));

COMMENT ON INDEX public.organization_domains_domain_unique IS
  'A domain (compared without case) resolves to exactly one unit.';
