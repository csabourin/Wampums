-- Camp review (#1257, second slice): sorting the notes after the camp, merging duplicates, and
-- closing the review.
--
-- - Each note may be marked to keep (a good move to repeat) or to fix, with a short action.
-- - Two devices offline may note the same idea separately: one note can then be merged into
--   another. The merged note keeps its words and its votes; the note it joins carries their weight.
--   A merge is one level deep: a note that others were merged into cannot itself be merged.
-- - Closing a camp's review freezes it. One row per camp that has been closed at least once; a camp
--   without a row has an open review.
ALTER TABLE public.camp_review_notes
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(10) CHECK (outcome IS NULL OR outcome IN ('keep', 'fix'));
ALTER TABLE public.camp_review_notes
  ADD COLUMN IF NOT EXISTS action_text TEXT CHECK (action_text IS NULL OR length(btrim(action_text)) BETWEEN 1 AND 280);
ALTER TABLE public.camp_review_notes
  ADD COLUMN IF NOT EXISTS merged_into_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'camp_review_notes_merged_into_fkey') THEN
    ALTER TABLE public.camp_review_notes
      ADD CONSTRAINT camp_review_notes_merged_into_fkey
      FOREIGN KEY (organization_id, merged_into_id) REFERENCES public.camp_review_notes(organization_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'camp_review_notes_not_merged_into_itself') THEN
    ALTER TABLE public.camp_review_notes
      ADD CONSTRAINT camp_review_notes_not_merged_into_itself CHECK (merged_into_id IS NULL OR merged_into_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS camp_review_notes_by_merge
  ON public.camp_review_notes (organization_id, merged_into_id) WHERE merged_into_id IS NOT NULL;

COMMENT ON COLUMN public.camp_review_notes.outcome IS
  'Set when the review is sorted after the camp: keep (a good move to repeat) or fix (a weakness to correct). NULL while not sorted.';
COMMENT ON COLUMN public.camp_review_notes.action_text IS
  'What to do about it, in a few words (for example "two pots instead of one"). Plain text.';
COMMENT ON COLUMN public.camp_review_notes.merged_into_id IS
  'The note this one was merged into, because it said the same thing. Its weight then counts in that note''s. One level deep, within one camp.';

CREATE TABLE IF NOT EXISTS public.camp_reviews (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, meeting_id),
  FOREIGN KEY (meeting_id, organization_id) REFERENCES public.year_plan_meetings(id, organization_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.camp_reviews IS
  'Whether a camp''s review is closed. A closed review refuses every change (409 camp_review_closed) until it is reopened. A camp without a row has an open review.';
