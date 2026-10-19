-- Track who entered a badge record and distinguish manually backfilled
-- progress from progress copied when a youth transfers between sibling units.
ALTER TABLE public.badge_progress
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.badge_progress.created_by IS
    'Account that entered or copied this badge progress record';

COMMENT ON COLUMN public.badge_progress.source_type IS
    'Origin type for badge progress record: oas_stage, pab_plan, top_award, manual, historical, transfer';
