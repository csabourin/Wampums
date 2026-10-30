-- A camp is always an activity; not every activity is a camp. The activity says so itself,
-- whether it was created in the year plan or from the activities page, so camp readiness,
-- camps coming up and the year plan agree on what a camp is.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS is_camp BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.activities a
   SET is_camp = TRUE
  FROM public.year_plan_meetings m
 WHERE m.activity_id = a.id
   AND m.organization_id = a.organization_id
   AND m.meeting_kind = 'camp'
   AND NOT a.is_camp;

CREATE INDEX IF NOT EXISTS activities_camps_by_start
  ON public.activities (organization_id, activity_start_date)
  WHERE is_camp AND is_active;

COMMENT ON COLUMN public.activities.is_camp IS 'Whether this activity is a camp. Set from the activity form or by planning a camp in the year plan; services/campDates.js keeps it and the planned date in step.';
