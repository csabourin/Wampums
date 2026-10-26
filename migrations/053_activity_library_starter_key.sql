-- A unit holds at most one copy of each starter activity
-- (config/activity_library_starter.json, services/activityLibraryStarter.js).
-- The copy records its source in metadata.starter_key. The index covers hidden
-- copies (is_active = FALSE) too: hiding an activity must not let a later
-- import or automatic installation create a second copy beside it. Each unit
-- has its own key space, so one unit's copy never refuses another's.
CREATE UNIQUE INDEX IF NOT EXISTS activity_library_starter_key_per_unit
  ON public.activity_library (organization_id, (metadata ->> 'starter_key'))
  WHERE metadata ? 'starter_key';

COMMENT ON INDEX public.activity_library_starter_key_per_unit IS 'One copy per unit of each starter activity, hidden copies included. Written only by services/activityLibraryStarter.js.';
