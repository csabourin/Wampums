ALTER TABLE activities
  ADD COLUMN activity_start_date date,
  ADD COLUMN activity_start_time time,
  ADD COLUMN activity_end_date date,
  ADD COLUMN activity_end_time time;

UPDATE activities
SET
  activity_start_date = COALESCE(activity_start_date, activity_date),
  activity_start_time = COALESCE(activity_start_time, meeting_time_going, departure_time_going),
  activity_end_date = COALESCE(activity_end_date, activity_date),
  activity_end_time = COALESCE(activity_end_time, departure_time_return, departure_time_going, meeting_time_going);

ALTER TABLE activities
  ALTER COLUMN activity_start_date SET NOT NULL,
  ALTER COLUMN activity_start_time SET NOT NULL,
  ALTER COLUMN activity_end_date SET NOT NULL,
  ALTER COLUMN activity_end_time SET NOT NULL;

ALTER TABLE activities
  ADD CONSTRAINT activities_start_before_end
  CHECK (
    activity_end_date > activity_start_date OR
    (activity_end_date = activity_start_date AND activity_end_time >= activity_start_time)
  );
