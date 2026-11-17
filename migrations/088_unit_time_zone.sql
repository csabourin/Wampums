-- "Today" is the unit's day, not the server's (#1458).
--
-- The application and PostgreSQL run in UTC. CURRENT_DATE and NOW()::timestamp
-- therefore turned over at 19:00 or 20:00 in Quebec: the evening's meeting left
-- the dashboard while it was being held, records made during it were dated the
-- next day, and a medication reminder compared a camp's local hours with UTC.
--
-- Each unit now has a time zone, and two functions read the clock there:
--   unit_today(organization_id) -> date       replaces CURRENT_DATE
--   unit_now(organization_id)   -> timestamp  to compare with the dates and
--                                             times of activities (no zone)

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/Toronto';

COMMENT ON COLUMN public.organizations.time_zone IS
  'IANA time zone where the unit meets. unit_today() and unit_now() read the clock there.';

-- Only a zone PostgreSQL knows by name: an unknown one would make every query
-- that asks for the unit's day fail.
CREATE OR REPLACE FUNCTION public.check_organization_time_zone() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.time_zone) THEN
    RAISE EXCEPTION 'Unknown time zone: %', NEW.time_zone USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_time_zone_check ON public.organizations;
CREATE TRIGGER organizations_time_zone_check
  BEFORE INSERT OR UPDATE OF time_zone ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.check_organization_time_zone();

-- An unknown unit reads the default zone rather than NULL: a NULL day would
-- silently empty every "upcoming" list.
CREATE OR REPLACE FUNCTION public.unit_now(p_organization_id integer)
RETURNS timestamp without time zone
LANGUAGE sql
STABLE
AS $$
  SELECT now() AT TIME ZONE COALESCE(
    (SELECT o.time_zone FROM public.organizations o WHERE o.id = p_organization_id),
    'America/Toronto'
  );
$$;

COMMENT ON FUNCTION public.unit_now(integer) IS
  'The current date and time where the unit is, without zone, to compare with activity dates and times.';

CREATE OR REPLACE FUNCTION public.unit_today(p_organization_id integer)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT public.unit_now(p_organization_id)::date;
$$;

COMMENT ON FUNCTION public.unit_today(integer) IS
  'Today''s date where the unit is. Use it instead of CURRENT_DATE.';

-- The functions that already existed and read the server's day.

CREATE OR REPLACE FUNCTION public.participant_organizations_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE participant_enrollments pe
     SET status = 'left', ended_on = public.unit_today(OLD.organization_id)
    FROM scout_years sy
   WHERE sy.id = pe.scout_year_id
     AND sy.status = 'active'
     AND pe.participant_id = OLD.participant_id
     AND pe.organization_id = OLD.organization_id
     AND pe.status = 'active';

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.participant_organizations_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_scout_year_id integer;
BEGIN
  SELECT sy.id INTO v_scout_year_id
    FROM scout_years sy
   WHERE sy.organization_id = NEW.organization_id AND sy.status = 'active'
   LIMIT 1;

  IF v_scout_year_id IS NULL THEN
    RAISE EXCEPTION 'No active scout year for organization %', NEW.organization_id;
  END IF;

  INSERT INTO participant_enrollments
          (participant_id, organization_id, scout_year_id, inscription_date, status)
   VALUES (NEW.participant_id, NEW.organization_id, v_scout_year_id,
           COALESCE(NEW.inscription_date, public.unit_today(NEW.organization_id)), 'active')
   ON CONFLICT (participant_id, organization_id, scout_year_id)
   DO UPDATE SET status = 'active', ended_on = NULL, exit_reason = NULL;

  RETURN NEW;
END;
$$;

-- A loan is overdue by the day of the unit that made it.
CREATE OR REPLACE FUNCTION equipment_loaned_quantity(p_equipment_id INTEGER, p_from DATE, p_activity_id INTEGER DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(quantity - returned_quantity), 0)::integer
    FROM equipment_loans
   WHERE equipment_id = p_equipment_id
     AND returned_at IS NULL
     AND (due_date IS NULL OR due_date >= p_from OR due_date < public.unit_today(organization_id))
     AND (p_activity_id IS NULL OR activity_id IS DISTINCT FROM p_activity_id);
$$;

CREATE OR REPLACE FUNCTION equipment_loans_beyond_reservations(
  p_equipment_id INTEGER,
  p_from DATE,
  p_to DATE,
  p_activity_id INTEGER DEFAULT NULL,
  p_except_reservation_id INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(GREATEST(0, loans.outstanding - COALESCE((
           SELECT SUM(r.reserved_quantity)
             FROM equipment_reservations r
            WHERE loans.activity_id IS NOT NULL
              AND r.activity_id = loans.activity_id
              AND r.equipment_id = p_equipment_id
              AND r.status IN ('reserved', 'confirmed')
              AND COALESCE(r.date_from, r.meeting_date) <= p_to
              AND COALESCE(r.date_to, r.meeting_date) >= p_from
              AND (p_except_reservation_id IS NULL OR r.id <> p_except_reservation_id)
         ), 0))), 0)::integer
    FROM (
      SELECT activity_id, SUM(quantity - returned_quantity) AS outstanding
        FROM equipment_loans
       WHERE equipment_id = p_equipment_id
         AND returned_at IS NULL
         AND (due_date IS NULL OR due_date >= p_from OR due_date < public.unit_today(organization_id))
         AND (p_activity_id IS NULL OR activity_id IS DISTINCT FROM p_activity_id)
       GROUP BY activity_id
    ) AS loans;
$$;
