-- A permission slip's emailed links keep only their digest (#1473).
--
-- A slip carried one access_token, a UUID stored as is and placed in every
-- email: whoever read the table could sign any slip. Each email now carries a
-- link of its own (utils/invitation-tokens.js); only its SHA-256 is stored, here.
-- Every link of a slip stays valid until the slip's text is reissued, which
-- changes the slip's generation (permission_slips.access_token, now an internal
-- id that no link contains).

CREATE TABLE IF NOT EXISTS public.permission_slip_links (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slip_id INTEGER NOT NULL REFERENCES public.permission_slips(id) ON DELETE CASCADE,
  slip_generation UUID NOT NULL,
  token_digest CHARACTER(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS permission_slip_links_slip_idx ON public.permission_slip_links (slip_id);

COMMENT ON TABLE public.permission_slip_links IS
  'Emailed links to answer a permission slip: the SHA-256 of each token, never the token. A link opens its slip while slip_generation matches the slip''s access_token.';
COMMENT ON COLUMN public.permission_slips.access_token IS
  'The slip''s generation: renewed when its text is reissued, which closes its links. Not a link token.';

-- Links already emailed keep working: each slip's current token becomes a
-- link (its digest), and the slip moves to a new generation the links point
-- to, so the old token is no longer stored anywhere. Deliveries follow.
-- Re-running finds every slip with a link and changes nothing.
WITH rotated AS (
  SELECT ps.id, ps.organization_id, ps.access_token AS old_token, gen_random_uuid() AS new_generation
    FROM public.permission_slips ps
   WHERE ps.access_token IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.permission_slip_links l WHERE l.slip_id = ps.id)
), kept_links AS (
  INSERT INTO public.permission_slip_links (organization_id, slip_id, slip_generation, token_digest)
  SELECT organization_id, id, new_generation, encode(sha256(convert_to(old_token::text, 'UTF8')), 'hex')
    FROM rotated
  ON CONFLICT (token_digest) DO NOTHING
  RETURNING slip_id
), moved_deliveries AS (
  UPDATE public.permission_slip_deliveries d
     SET access_token = r.new_generation
    FROM rotated r
   WHERE d.slip_id = r.id AND d.access_token = r.old_token
  RETURNING d.id
)
UPDATE public.permission_slips ps
   SET access_token = r.new_generation
  FROM rotated r
 WHERE ps.id = r.id;
