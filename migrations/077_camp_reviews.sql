-- Camp review (#1257, first slice): what was liked, less liked and what to improve, noted quickly
-- at the end of a camp, often without a network.
--
-- A note and each "+1" given to it carry an id the device chose (UUID), so writing either is
-- idempotent: a change replayed from the offline outbox lands once. A "+1" is a row, not a counter,
-- so a lost response replayed never counts twice, and undoing it deletes exactly that row. A note's
-- weight is 1 plus its votes. There is no vote against: a disagreement is another note.
--
-- Reading takes camp_reviews.view, given by default to the unit-wide roles that read the year plan
-- (meetings.view); writing takes camp_reviews.manage, given to those that plan it (meetings.manage).
-- The district role receives both through its trigger.
SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1, false);
INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES
  ('camp_reviews.view', 'View camp reviews', 'camp_plan',
   'Read what a camp''s review noted: liked, less liked, to improve, and the weight of each note'),
  ('camp_reviews.manage', 'Write camp reviews', 'camp_plan',
   'Add, edit and remove a camp''s review notes, and add or undo a "+1" on them')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
  FROM public.roles r
  JOIN public.role_permissions rp ON rp.role_id = r.id
  JOIN public.permissions held ON held.id = rp.permission_id
  JOIN public.permissions p ON (
    (p.permission_key = 'camp_reviews.view' AND held.permission_key = 'meetings.view')
    OR (p.permission_key = 'camp_reviews.manage' AND held.permission_key = 'meetings.manage'))
 WHERE r.data_scope = 'organization'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.camp_review_notes (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  meeting_id INTEGER NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('liked', 'disliked', 'improve')),
  moment VARCHAR(20) NOT NULL CHECK (moment IN ('youth_council', 'team_daily', 'team_after')),
  day DATE,
  theme VARCHAR(20) CHECK (theme IS NULL OR theme IN ('activity', 'meals', 'equipment', 'site', 'organization', 'leadership')),
  note_text TEXT NOT NULL CHECK (length(btrim(note_text)) BETWEEN 1 AND 280),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (meeting_id, organization_id) REFERENCES public.year_plan_meetings(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS camp_review_notes_by_camp ON public.camp_review_notes (organization_id, meeting_id);

COMMENT ON TABLE public.camp_review_notes IS
  'One thing a camp''s review noted (liked, less liked, to improve). The id is chosen by the device that wrote it, so a replayed offline write lands once. Collective notes: they name no youth. Written through services/campReviews.js.';
COMMENT ON COLUMN public.camp_review_notes.moment IS
  'When it was said: youth_council (the youth, at the end of the camp), team_daily (the team, the evening of `day`), team_after (the team, after the camp).';
COMMENT ON COLUMN public.camp_review_notes.version IS
  'Incremented by each edit; an edit names the version it was made against, so a stale one is refused (409).';

CREATE TABLE IF NOT EXISTS public.camp_review_votes (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  note_id UUID NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, note_id) REFERENCES public.camp_review_notes(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS camp_review_votes_by_note ON public.camp_review_votes (organization_id, note_id);

COMMENT ON TABLE public.camp_review_votes IS
  'One "+1" given to a camp review note: someone else said the same thing. A row, not a counter, so a replayed "+1" counts once and undoing it removes exactly that one. A note''s weight is 1 plus its votes.';
