-- What the marketing site last told search engines about each public page.
--
-- After a deploy, services/indexNow.js fingerprints every page of wampums.app
-- (its title, description and visible text, not its markup or styles) and
-- submits through IndexNow only the pages whose fingerprint changed, the new
-- ones, and the ones that disappeared. This table remembers what was sent, so
-- a redeploy that changes nothing a reader sees submits nothing, and a page
-- submitted moments ago waits before it is sent again.
--
-- The site belongs to no unit, so the table has no organization_id.

CREATE TABLE IF NOT EXISTS public.indexnow_submissions (
  url TEXT PRIMARY KEY,
  fingerprint TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
  removed_at TIMESTAMP WITH TIME ZONE,
  last_status INTEGER
);

COMMENT ON TABLE public.indexnow_submissions IS
  'Last IndexNow submission per public wampums.app URL; site-wide, not per unit.';
COMMENT ON COLUMN public.indexnow_submissions.fingerprint IS
  'SHA-256 of the page''s meaningful content when last submitted; NULL once the page is gone.';
COMMENT ON COLUMN public.indexnow_submissions.removed_at IS
  'When the page was last submitted as removed from the site; NULL while it exists.';
COMMENT ON COLUMN public.indexnow_submissions.last_status IS
  'HTTP status IndexNow answered to the last accepted submission (200 or 202).';
