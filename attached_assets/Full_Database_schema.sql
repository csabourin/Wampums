--
-- PostgreSQL database dump
--

\restrict gJjnYqQhHIoLpimte7cmxRu8e7oe8dxT2yjqPbaDadautsPtsV0vlWO6li8akVb

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.4 (Debian 18.4-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: check_carpool_seat_availability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_carpool_seat_availability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_total_seats INTEGER;
  v_assigned_seats INTEGER;
  v_trip_direction VARCHAR(20);
BEGIN
  -- Get the carpool offer details
  SELECT total_seats_available, trip_direction
  INTO v_total_seats, v_trip_direction
  FROM carpool_offers
  WHERE id = NEW.carpool_offer_id AND is_active = TRUE;

  -- Check if offer exists and is active
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Carpool offer not found or is not active';
  END IF;

  -- Validate trip direction compatibility
  IF v_trip_direction = 'to_activity' AND NEW.trip_direction IN ('from_activity', 'both') THEN
    RAISE EXCEPTION 'Cannot assign % trip to a % only offer', NEW.trip_direction, v_trip_direction;
  END IF;

  IF v_trip_direction = 'from_activity' AND NEW.trip_direction IN ('to_activity', 'both') THEN
    RAISE EXCEPTION 'Cannot assign % trip to a % only offer', NEW.trip_direction, v_trip_direction;
  END IF;

  -- Count current assignments for the relevant direction(s)
  SELECT COUNT(DISTINCT participant_id)
  INTO v_assigned_seats
  FROM carpool_assignments
  WHERE carpool_offer_id = NEW.carpool_offer_id
    AND id != COALESCE(NEW.id, -1)  -- Exclude current record if updating
    AND (
      (NEW.trip_direction = 'both' AND trip_direction IN ('both', 'to_activity', 'from_activity'))
      OR (NEW.trip_direction = 'to_activity' AND trip_direction IN ('both', 'to_activity'))
      OR (NEW.trip_direction = 'from_activity' AND trip_direction IN ('both', 'from_activity'))
    );

  -- Check if there are available seats
  IF v_assigned_seats >= v_total_seats THEN
    RAISE EXCEPTION 'No available seats in this carpool offer (% of % seats used)', v_assigned_seats, v_total_seats;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: create_form_submission_audit_trail(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_form_submission_audit_trail() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only create audit entry if data actually changed
  IF OLD.submission_data IS DISTINCT FROM NEW.submission_data
     OR OLD.status IS DISTINCT FROM NEW.status THEN

    INSERT INTO form_submission_history (
      form_submission_id,
      submission_data,
      status,
      edited_by,
      edited_at,
      changes_summary
    ) VALUES (
      OLD.id,
      OLD.submission_data,
      OLD.status,
      NEW.user_id,  -- Track who made the change
      NOW(),
      jsonb_build_object(
        'status_changed', OLD.status != NEW.status,
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: create_new_form_version(integer, jsonb, character varying, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_new_form_version(p_form_format_id integer, p_form_structure jsonb, p_display_name character varying, p_change_description text, p_created_by uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_next_version INTEGER;
  v_new_version_id INTEGER;
BEGIN
  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM form_format_versions
  WHERE form_format_id = p_form_format_id;

  -- Insert new version
  INSERT INTO form_format_versions (
    form_format_id,
    version_number,
    form_structure,
    display_name,
    change_description,
    created_by,
    is_active
  ) VALUES (
    p_form_format_id,
    v_next_version,
    p_form_structure,
    p_display_name,
    p_change_description,
    p_created_by,
    false  -- New versions start as inactive
  ) RETURNING id INTO v_new_version_id;

  RETURN v_new_version_id;
END;
$$;


--
-- Name: form_has_context(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.form_has_context(p_form_id integer, p_context text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  v_contexts TEXT[];
BEGIN
  SELECT display_context INTO v_contexts
  FROM organization_form_formats
  WHERE id = p_form_id;

  RETURN p_context = ANY(v_contexts);
END;
$$;


--
-- Name: FUNCTION form_has_context(p_form_id integer, p_context text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.form_has_context(p_form_id integer, p_context text) IS 'Check if a form has a specific display context';


--
-- Name: form_submissions_set_scout_year(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.form_submissions_set_scout_year() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.scout_year_id IS NOT NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Every column is qualified: `id`, `status` and `organization_id` all exist
  -- on the row being inserted too, and an unqualified reference is ambiguous.
  SELECT sy.id INTO NEW.scout_year_id
    FROM scout_years sy
   WHERE sy.organization_id = NEW.organization_id
     AND COALESCE(NEW.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   LIMIT 1;

  IF NEW.scout_year_id IS NULL THEN
    SELECT sy.id INTO NEW.scout_year_id
      FROM scout_years sy
     WHERE sy.organization_id = NEW.organization_id
       AND sy.status = 'active'
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: medication_authorization_set_scout_year(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.medication_authorization_set_scout_year() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.scout_year_id IS NOT NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Every column is qualified: `id`, `status` and `organization_id` all exist
  -- on the authorization row too, and an unqualified reference is ambiguous.
  SELECT sy.id INTO NEW.scout_year_id
    FROM scout_years sy
   WHERE sy.organization_id = NEW.organization_id
     AND COALESCE(NEW.date_signature, NEW.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   LIMIT 1;

  IF NEW.scout_year_id IS NULL THEN
    SELECT sy.id INTO NEW.scout_year_id
      FROM scout_years sy
     WHERE sy.organization_id = NEW.organization_id AND sy.status = 'active'
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: notify_announcement_scheduled(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_announcement_scheduled() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  payload JSON;
BEGIN
  -- Only notify for scheduled announcements
  IF NEW.status = 'scheduled' THEN
    -- Build JSON payload with announcement details
    payload := json_build_object(
      'id', NEW.id,
      'organization_id', NEW.organization_id,
      'scheduled_at', NEW.scheduled_at,
      'subject', NEW.subject
    );

    -- Send notification on 'announcement_scheduled' channel
    PERFORM pg_notify('announcement_scheduled', payload::text);

    RAISE NOTICE 'Announcement scheduled notification sent: %', payload;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION notify_announcement_scheduled(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.notify_announcement_scheduled() IS 'Trigger function that sends NOTIFY when announcements are scheduled. Used to eliminate polling and reduce compute usage.';


--
-- Name: participant_groups_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participant_groups_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM participant_group_assignments pga
   USING scout_years sy
   WHERE sy.id = pga.scout_year_id
     AND sy.status = 'active'
     AND pga.participant_id = OLD.participant_id
     AND pga.organization_id = OLD.organization_id;

  RETURN OLD;
END;
$$;


--
-- Name: participant_groups_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participant_groups_insert() RETURNS trigger
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

  INSERT INTO participant_group_assignments
          (participant_id, group_id, organization_id, scout_year_id,
           first_leader, second_leader, roles)
   VALUES (NEW.participant_id, NEW.group_id, NEW.organization_id, v_scout_year_id,
           COALESCE(NEW.first_leader, FALSE), COALESCE(NEW.second_leader, FALSE), NEW.roles)
   ON CONFLICT (participant_id, organization_id, scout_year_id)
   DO UPDATE SET group_id = EXCLUDED.group_id,
                 first_leader = EXCLUDED.first_leader,
                 second_leader = EXCLUDED.second_leader,
                 roles = EXCLUDED.roles;

  RETURN NEW;
END;
$$;


--
-- Name: participant_groups_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participant_groups_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE participant_group_assignments pga
     SET group_id = NEW.group_id,
         first_leader = COALESCE(NEW.first_leader, FALSE),
         second_leader = COALESCE(NEW.second_leader, FALSE),
         roles = NEW.roles
    FROM scout_years sy
   WHERE sy.id = pga.scout_year_id
     AND sy.status = 'active'
     AND pga.participant_id = OLD.participant_id
     AND pga.organization_id = OLD.organization_id;

  RETURN NEW;
END;
$$;


--
-- Name: participant_organizations_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participant_organizations_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE participant_enrollments pe
     SET status = 'left', ended_on = CURRENT_DATE
    FROM scout_years sy
   WHERE sy.id = pe.scout_year_id
     AND sy.status = 'active'
     AND pe.participant_id = OLD.participant_id
     AND pe.organization_id = OLD.organization_id
     AND pe.status = 'active';

  RETURN OLD;
END;
$$;


--
-- Name: participant_organizations_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participant_organizations_insert() RETURNS trigger
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
           COALESCE(NEW.inscription_date, CURRENT_DATE), 'active')
   ON CONFLICT (participant_id, organization_id, scout_year_id)
   DO UPDATE SET status = 'active', ended_on = NULL, exit_reason = NULL;

  RETURN NEW;
END;
$$;


--
-- Name: participant_organizations_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participant_organizations_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE participant_enrollments pe
     SET inscription_date = NEW.inscription_date
    FROM scout_years sy
   WHERE sy.id = pe.scout_year_id
     AND sy.status = 'active'
     AND pe.participant_id = OLD.participant_id
     AND pe.organization_id = OLD.organization_id
     AND pe.status = 'active';

  RETURN NEW;
END;
$$;


--
-- Name: points_set_scout_year(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.points_set_scout_year() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.scout_year_id IS NOT NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Every column is qualified: `id`, `status` and `organization_id` all exist
  -- on the row being inserted too, and an unqualified reference is ambiguous.
  SELECT sy.id INTO NEW.scout_year_id
    FROM scout_years sy
   WHERE sy.organization_id = NEW.organization_id
     AND COALESCE(NEW.created_at, now())::date BETWEEN sy.start_date AND sy.end_date
   LIMIT 1;

  IF NEW.scout_year_id IS NULL THEN
    SELECT sy.id INTO NEW.scout_year_id
      FROM scout_years sy
     WHERE sy.organization_id = NEW.organization_id
       AND sy.status = 'active'
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: publish_form_version(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_form_version(p_version_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_form_format_id INTEGER;
  v_version_number INTEGER;
BEGIN
  -- Get the form_format_id for this version
  SELECT form_format_id, version_number INTO v_form_format_id, v_version_number
  FROM form_format_versions
  WHERE id = p_version_id;

  IF v_form_format_id IS NULL THEN
    RAISE EXCEPTION 'Version ID % not found', p_version_id;
  END IF;

  -- Deactivate all other versions for this form
  UPDATE form_format_versions
  SET is_active = false
  WHERE form_format_id = v_form_format_id AND id != p_version_id;

  -- Activate this version
  UPDATE form_format_versions
  SET is_active = true
  WHERE id = p_version_id;

  -- Update the form format to point to this version and set as published
  UPDATE organization_form_formats
  SET current_version_id = p_version_id,
      status = 'published',
      published_at = CASE WHEN published_at IS NULL THEN NOW() ELSE published_at END,
      updated_at = NOW()
  WHERE id = v_form_format_id;

END;
$$;


--
-- Name: scout_year_for_date(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scout_year_for_date(p_organization_id integer, p_on_date date) RETURNS TABLE(year_label text, year_start date, year_end date)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_setting    jsonb;
  v_month      integer := 9;
  v_day        integer := 1;
  v_start_year integer;
  v_start      date;
BEGIN
  SELECT setting_value
    INTO v_setting
    FROM organization_settings
   WHERE organization_id = p_organization_id
     AND setting_key = 'fiscal_year'
   LIMIT 1;

  IF v_setting IS NOT NULL THEN
    v_month := COALESCE(NULLIF(v_setting->>'start_month', '')::integer, 9);
    v_day   := COALESCE(NULLIF(v_setting->>'start_day', '')::integer, 1);
  END IF;

  -- Guard against an out-of-range configuration rather than raising.
  IF v_month < 1 OR v_month > 12 THEN
    v_month := 9;
  END IF;
  IF v_day < 1 OR v_day > 28 THEN
    v_day := LEAST(GREATEST(v_day, 1), 28);
  END IF;

  v_start_year := EXTRACT(YEAR FROM p_on_date)::integer;
  v_start := make_date(v_start_year, v_month, v_day);

  IF p_on_date < v_start THEN
    v_start_year := v_start_year - 1;
    v_start := make_date(v_start_year, v_month, v_day);
  END IF;

  year_label := v_start_year::text || '-' || (v_start_year + 1)::text;
  year_start := v_start;
  year_end   := (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date;
  RETURN NEXT;
END;
$$;


--
-- Name: FUNCTION scout_year_for_date(p_organization_id integer, p_on_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scout_year_for_date(p_organization_id integer, p_on_date date) IS 'Scout year label and boundaries containing p_on_date, based on the organization fiscal_year setting.';


--
-- Name: update_activities_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_activities_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


--
-- Name: update_carpool_assignments_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_carpool_assignments_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


--
-- Name: update_carpool_offers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_carpool_offers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


--
-- Name: update_google_chat_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_google_chat_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_incident_reports_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_incident_reports_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


--
-- Name: update_medication_receptions_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_medication_receptions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points (
    id integer NOT NULL,
    participant_id integer,
    group_id integer,
    value integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id integer,
    honor_id integer,
    scout_year_id integer
);


--
-- Name: COLUMN points.honor_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.points.honor_id IS 'Links point award to honor (CASCADE delete on honor removal)';


--
-- Name: scout_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_years (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    label text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'planning'::text NOT NULL,
    closed_at timestamp with time zone,
    closed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scout_years_dates_ordered CHECK ((end_date > start_date)),
    CONSTRAINT scout_years_status_check CHECK ((status = ANY (ARRAY['planning'::text, 'active'::text, 'closed'::text])))
);


--
-- Name: active_year_points; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.active_year_points AS
 SELECT p.id,
    p.participant_id,
    p.group_id,
    p.value,
    p.created_at,
    p.organization_id,
    p.honor_id,
    p.scout_year_id
   FROM (public.points p
     JOIN public.scout_years sy ON ((sy.id = p.scout_year_id)))
  WHERE (sy.status = 'active'::text);


--
-- Name: VIEW active_year_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.active_year_points IS 'Read-only view over points, restricted to each organization active scout year.';


--
-- Name: activites_rencontre; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activites_rencontre (
    id bigint NOT NULL,
    activity text NOT NULL,
    type text NOT NULL,
    estimated_time_min integer NOT NULL,
    estimated_time_max integer NOT NULL,
    material text,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    created_by uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    activity_date date NOT NULL,
    meeting_location_going text NOT NULL,
    meeting_time_going time without time zone NOT NULL,
    departure_time_going time without time zone NOT NULL,
    meeting_location_return text,
    meeting_time_return time without time zone,
    departure_time_return time without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    activity_start_date date NOT NULL,
    activity_start_time time without time zone NOT NULL,
    activity_end_date date NOT NULL,
    activity_end_time time without time zone NOT NULL,
    CONSTRAINT activities_start_before_end CHECK (((activity_end_date > activity_start_date) OR ((activity_end_date = activity_start_date) AND (activity_end_time >= activity_start_time)))),
    CONSTRAINT valid_going_times CHECK ((departure_time_going >= meeting_time_going))
);


--
-- Name: TABLE activities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.activities IS 'Calendar of activities/events for organizations';


--
-- Name: COLUMN activities.meeting_location_going; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.meeting_location_going IS 'Meeting point before departure to activity';


--
-- Name: COLUMN activities.meeting_time_going; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.meeting_time_going IS 'Time to meet before going to activity';


--
-- Name: COLUMN activities.departure_time_going; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.departure_time_going IS 'Time when carpools depart to activity';


--
-- Name: COLUMN activities.meeting_location_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.meeting_location_return IS 'Meeting point for return journey';


--
-- Name: COLUMN activities.meeting_time_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.meeting_time_return IS 'Time to meet for return trip';


--
-- Name: COLUMN activities.departure_time_return; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.departure_time_return IS 'Time when carpools depart on return';


--
-- Name: activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activities_id_seq OWNED BY public.activities.id;


--
-- Name: activity_distribution_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_distribution_rules (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    year_plan_id integer NOT NULL,
    activity_library_id integer,
    activity_name character varying(255) NOT NULL,
    distribution_scope character varying(20) DEFAULT 'period'::character varying NOT NULL,
    placement_rule character varying(30) DEFAULT 'near_end'::character varying NOT NULL,
    occurrences_per_scope integer DEFAULT 1 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT activity_distribution_rules_distribution_scope_check CHECK (((distribution_scope)::text = ANY (ARRAY[('year'::character varying)::text, ('period'::character varying)::text, ('month'::character varying)::text]))),
    CONSTRAINT activity_distribution_rules_placement_rule_check CHECK (((placement_rule)::text = ANY (ARRAY[('near_start'::character varying)::text, ('near_end'::character varying)::text, ('evenly_spaced'::character varying)::text, ('manual'::character varying)::text])))
);


--
-- Name: activity_distribution_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_distribution_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_distribution_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_distribution_rules_id_seq OWNED BY public.activity_distribution_rules.id;


--
-- Name: activity_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_library (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category character varying(100),
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    estimated_duration_min integer,
    estimated_duration_max integer,
    material text,
    objective_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    avg_rating numeric(3,2),
    times_used integer DEFAULT 0 NOT NULL,
    last_used_date date,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);


--
-- Name: activity_library_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_library_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_library_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_library_id_seq OWNED BY public.activity_library.id;


--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    month_key text NOT NULL,
    organization_id integer,
    provider text NOT NULL,
    feature text NOT NULL,
    model text,
    input_tokens integer,
    output_tokens integer,
    estimated_cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    success boolean DEFAULT false NOT NULL,
    error_code text,
    user_id uuid
);


--
-- Name: ai_usage_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_monthly (
    month_key text NOT NULL,
    cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: announcement_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_logs (
    id integer NOT NULL,
    announcement_id integer,
    channel character varying(32) NOT NULL,
    recipient_email text,
    recipient_user_id uuid,
    status character varying(32) NOT NULL,
    error_message text,
    metadata jsonb,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE announcement_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.announcement_logs IS 'Logs for announcement deliveries. Supported channels: email, push, whatsapp. Status can be: sent, failed.';


--
-- Name: announcement_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcement_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcement_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcement_logs_id_seq OWNED BY public.announcement_logs.id;


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    created_by uuid NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    recipient_roles text[] DEFAULT '{}'::text[] NOT NULL,
    recipient_groups integer[] DEFAULT '{}'::integer[],
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcements_id_seq OWNED BY public.announcements.id;


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id integer NOT NULL,
    participant_id integer NOT NULL,
    date date NOT NULL,
    status character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    point_adjustment integer DEFAULT 0,
    organization_id integer
);


--
-- Name: attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_id_seq OWNED BY public.attendance.id;


--
-- Name: badge_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badge_progress (
    id integer NOT NULL,
    participant_id integer,
    territoire_chasse character varying(255) NOT NULL,
    objectif text,
    description text,
    fierte boolean,
    raison text,
    date_obtention date,
    etoiles integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(20) DEFAULT 'pending'::character varying,
    approval_date timestamp without time zone,
    organization_id integer,
    badge_template_id integer NOT NULL,
    section character varying(255) NOT NULL,
    delivered_at timestamp without time zone,
    delivered_by uuid,
    star_type character varying(20) DEFAULT 'proie'::character varying,
    source_type character varying(30),
    source_id bigint,
    attempt_no integer DEFAULT 1 NOT NULL,
    CONSTRAINT badge_progress_star_type_check CHECK (((star_type)::text = ANY (ARRAY[('proie'::character varying)::text, ('battue'::character varying)::text])))
);


--
-- Name: COLUMN badge_progress.etoiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.badge_progress.etoiles IS 'Star number/index (1, 2, 3, etc.) not quantity. Each star is a separate row.';


--
-- Name: COLUMN badge_progress.delivered_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.badge_progress.delivered_at IS 'Timestamp when the physical badge/star was given to the participant';


--
-- Name: COLUMN badge_progress.star_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.badge_progress.star_type IS 'Achievement type: proie (individual accomplishment) or battue (group activity)';


--
-- Name: COLUMN badge_progress.source_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.badge_progress.source_type IS 'Origin type for badge progress record: oas_stage, pab_plan, top_award, manual';


--
-- Name: COLUMN badge_progress.source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.badge_progress.source_id IS 'Origin record identifier from the source table';


--
-- Name: COLUMN badge_progress.attempt_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.badge_progress.attempt_no IS 'Attempt number for repeatable source-driven badge submissions';


--
-- Name: badge_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.badge_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: badge_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.badge_progress_id_seq OWNED BY public.badge_progress.id;


--
-- Name: badge_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badge_templates (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    template_key character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    translation_key character varying(255),
    section character varying(255) DEFAULT 'general'::character varying NOT NULL,
    level_count integer DEFAULT 3 NOT NULL,
    levels jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image character varying(255),
    program_type character varying(30) DEFAULT 'legacy_badge'::character varying NOT NULL,
    official_key character varying(255),
    version integer DEFAULT 1 NOT NULL,
    requirements jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: COLUMN badge_templates.image; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.badge_templates.image IS 'Filename of badge image (stored in /assets/images/ directory). Example: kaa.webp';


--
-- Name: badge_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.badge_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: badge_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.badge_templates_id_seq OWNED BY public.badge_templates.id;


--
-- Name: budget_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_categories (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    category_type character varying(20) DEFAULT 'other'::character varying,
    display_order integer DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT budget_categories_category_type_check CHECK (((category_type)::text = ANY (ARRAY[('registration'::character varying)::text, ('fundraising'::character varying)::text, ('activity'::character varying)::text, ('operations'::character varying)::text, ('other'::character varying)::text])))
);


--
-- Name: budget_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_categories_id_seq OWNED BY public.budget_categories.id;


--
-- Name: budget_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_expenses (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    budget_category_id integer,
    budget_item_id integer,
    amount numeric(10,2) NOT NULL,
    expense_date date NOT NULL,
    description text NOT NULL,
    payment_method character varying(50),
    reference_number character varying(100),
    receipt_url text,
    notes text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT positive_amount CHECK ((amount >= (0)::numeric))
);


--
-- Name: budget_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_expenses_id_seq OWNED BY public.budget_expenses.id;


--
-- Name: budget_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_items (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    budget_category_id integer NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    item_type character varying(20) DEFAULT 'other'::character varying,
    unit_price numeric(10,2),
    estimated_quantity integer,
    display_order integer DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT budget_items_item_type_check CHECK (((item_type)::text = ANY (ARRAY[('revenue'::character varying)::text, ('expense'::character varying)::text, ('both'::character varying)::text])))
);


--
-- Name: budget_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_items_id_seq OWNED BY public.budget_items.id;


--
-- Name: budget_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_plans (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    budget_item_id integer,
    fiscal_year_start date NOT NULL,
    fiscal_year_end date NOT NULL,
    budgeted_revenue numeric(10,2) DEFAULT 0,
    budgeted_expense numeric(10,2) DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: budget_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_plans_id_seq OWNED BY public.budget_plans.id;


--
-- Name: budget_revenues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_revenues (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    budget_category_id integer,
    budget_item_id integer,
    revenue_type character varying(50) DEFAULT 'other'::character varying,
    amount numeric(10,2) NOT NULL,
    revenue_date date NOT NULL,
    description text NOT NULL,
    payment_method character varying(50),
    reference_number character varying(100),
    receipt_url text,
    notes text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT positive_revenue_amount CHECK ((amount >= (0)::numeric))
);


--
-- Name: budget_revenues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_revenues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_revenues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_revenues_id_seq OWNED BY public.budget_revenues.id;


--
-- Name: fundraiser_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fundraiser_entries (
    participant_id integer,
    amount integer DEFAULT 0 NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    amount_paid double precision DEFAULT '0'::double precision,
    fundraiser integer,
    id integer NOT NULL
);


--
-- Name: COLUMN fundraiser_entries.amount_paid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fundraiser_entries.amount_paid IS 'Amount paid';


--
-- Name: calendars_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fundraiser_entries ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.calendars_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: carpool_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carpool_assignments (
    id integer NOT NULL,
    carpool_offer_id integer NOT NULL,
    participant_id integer NOT NULL,
    assigned_by uuid NOT NULL,
    organization_id integer NOT NULL,
    trip_direction character varying(20) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT carpool_assignments_trip_direction_check CHECK (((trip_direction)::text = ANY (ARRAY[('both'::character varying)::text, ('to_activity'::character varying)::text, ('from_activity'::character varying)::text])))
);


--
-- Name: TABLE carpool_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.carpool_assignments IS 'Assignments of participants to carpool vehicles';


--
-- Name: COLUMN carpool_assignments.assigned_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.carpool_assignments.assigned_by IS 'User who made this assignment (parent or animation staff)';


--
-- Name: COLUMN carpool_assignments.trip_direction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.carpool_assignments.trip_direction IS 'Which part of trip this assignment covers: both, to_activity, or from_activity';


--
-- Name: carpool_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.carpool_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: carpool_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.carpool_assignments_id_seq OWNED BY public.carpool_assignments.id;


--
-- Name: carpool_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carpool_offers (
    id integer NOT NULL,
    activity_id integer NOT NULL,
    user_id uuid NOT NULL,
    organization_id integer NOT NULL,
    vehicle_make character varying(100) NOT NULL,
    vehicle_color character varying(50) NOT NULL,
    total_seats_available integer NOT NULL,
    trip_direction character varying(20) NOT NULL,
    notes text,
    is_active boolean DEFAULT true,
    cancelled_at timestamp with time zone,
    cancelled_reason text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT carpool_offers_total_seats_available_check CHECK (((total_seats_available > 0) AND (total_seats_available <= 8))),
    CONSTRAINT carpool_offers_trip_direction_check CHECK (((trip_direction)::text = ANY (ARRAY[('both'::character varying)::text, ('to_activity'::character varying)::text, ('from_activity'::character varying)::text]))),
    CONSTRAINT positive_seats CHECK ((total_seats_available > 0))
);


--
-- Name: TABLE carpool_offers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.carpool_offers IS 'Carpool ride offers from parents and animation staff';


--
-- Name: COLUMN carpool_offers.total_seats_available; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.carpool_offers.total_seats_available IS 'Total seats available excluding driver. Front seat should only be used by driver own child if local laws allow';


--
-- Name: COLUMN carpool_offers.trip_direction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.carpool_offers.trip_direction IS 'Direction of ride: both (round trip), to_activity (one-way to), from_activity (one-way from)';


--
-- Name: COLUMN carpool_offers.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.carpool_offers.is_active IS 'Whether this ride offer is still available';


--
-- Name: COLUMN carpool_offers.cancelled_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.carpool_offers.cancelled_reason IS 'Reason provided when ride is cancelled';


--
-- Name: carpool_offers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.carpool_offers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: carpool_offers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.carpool_offers_id_seq OWNED BY public.carpool_offers.id;


--
-- Name: equipment_item_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_item_organizations (
    equipment_id integer NOT NULL,
    organization_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: equipment_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_items (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    name character varying(150) NOT NULL,
    category character varying(100),
    description text,
    quantity_total integer DEFAULT 1 NOT NULL,
    quantity_available integer DEFAULT 0 NOT NULL,
    condition_note text,
    is_active boolean DEFAULT true,
    attributes jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    acquisition_date date DEFAULT now(),
    item_value numeric,
    photo_url text,
    location_type character varying(50) DEFAULT 'local_scout_hall'::character varying NOT NULL,
    location_details character varying(500) DEFAULT ''::character varying,
    CONSTRAINT equipment_items_location_type_check CHECK (((location_type)::text = ANY (ARRAY[('local_scout_hall'::character varying)::text, ('warehouse'::character varying)::text, ('leader_home'::character varying)::text, ('other'::character varying)::text]))),
    CONSTRAINT equipment_items_quantity_available_check CHECK ((quantity_available >= 0)),
    CONSTRAINT equipment_items_quantity_total_check CHECK ((quantity_total >= 0))
);


--
-- Name: COLUMN equipment_items.acquisition_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.equipment_items.acquisition_date IS 'Purchased / Received when';


--
-- Name: COLUMN equipment_items.item_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.equipment_items.item_value IS 'value / price';


--
-- Name: COLUMN equipment_items.photo_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.equipment_items.photo_url IS 'URL for inventory photo';


--
-- Name: equipment_item_organizations_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.equipment_item_organizations_view WITH (security_invoker='on') AS
 SELECT eio.equipment_id,
    eio.organization_id,
    ei.name,
    ei.category,
    ei.location_type,
    ei.location_details,
    ei.quantity_total,
    ei.quantity_available,
    ei.is_active,
    ei.photo_url,
    ei.item_value,
    ei.acquisition_date
   FROM (public.equipment_item_organizations eio
     JOIN public.equipment_items ei ON ((ei.id = eio.equipment_id)));


--
-- Name: equipment_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_items_id_seq OWNED BY public.equipment_items.id;


--
-- Name: equipment_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_reservations (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    equipment_id integer NOT NULL,
    meeting_id integer,
    meeting_date date NOT NULL,
    reserved_quantity integer DEFAULT 1 NOT NULL,
    reserved_for character varying(200) DEFAULT ''::character varying NOT NULL,
    status character varying(20) DEFAULT 'reserved'::character varying,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_from date,
    date_to date,
    activity_id integer,
    CONSTRAINT equipment_reservations_reserved_quantity_check CHECK ((reserved_quantity > 0)),
    CONSTRAINT equipment_reservations_status_check CHECK (((status)::text = ANY (ARRAY[('reserved'::character varying)::text, ('confirmed'::character varying)::text, ('returned'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: COLUMN equipment_reservations.activity_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.equipment_reservations.activity_id IS 'Links reservation to an activity. When set, date_from and date_to are automatically populated from the activity date. Nullable for standalone reservations.';


--
-- Name: equipment_reservations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_reservations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_reservations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_reservations_id_seq OWNED BY public.equipment_reservations.id;


--
-- Name: erasure_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erasure_log (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    performed_by uuid,
    participants_erased integer DEFAULT 0 NOT NULL,
    guardians_erased integer DEFAULT 0 NOT NULL,
    users_erased integer DEFAULT 0 NOT NULL,
    users_retained integer DEFAULT 0 NOT NULL,
    rows_deleted jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE erasure_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.erasure_log IS 'One row per honoured erasure request. Holds counts only, never a name, an email or a participant id: the point is to prove the request was carried out without reconstituting the person.';


--
-- Name: COLUMN erasure_log.users_retained; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.erasure_log.users_retained IS 'Parent accounts deliberately kept: they still have another enrolled child, or they hold a non-parent role in the unit. Reported so the admin knows the request was only partly applicable.';


--
-- Name: erasure_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erasure_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erasure_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erasure_log_id_seq OWNED BY public.erasure_log.id;


--
-- Name: fee_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_definitions (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    registration_fee numeric(10,2) NOT NULL,
    membership_fee numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    year_start date NOT NULL,
    year_end date NOT NULL,
    budget_category_id integer
);


--
-- Name: fee_definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fee_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fee_definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fee_definitions_id_seq OWNED BY public.fee_definitions.id;


--
-- Name: first_aid_supplies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.first_aid_supplies (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    administrable_medication boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: first_aid_supplies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.first_aid_supplies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: first_aid_supplies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.first_aid_supplies_id_seq OWNED BY public.first_aid_supplies.id;


--
-- Name: form_format_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_format_versions (
    id integer NOT NULL,
    form_format_id integer NOT NULL,
    version_number integer NOT NULL,
    form_structure jsonb NOT NULL,
    display_name character varying(255),
    change_description text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    is_active boolean DEFAULT false
);


--
-- Name: TABLE form_format_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.form_format_versions IS 'Stores all versions of form formats for audit and rollback';


--
-- Name: COLUMN form_format_versions.version_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.form_format_versions.version_number IS 'Sequential version number starting at 1';


--
-- Name: COLUMN form_format_versions.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.form_format_versions.is_active IS 'Only one version should be active per form at a time';


--
-- Name: form_format_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.form_format_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: form_format_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.form_format_versions_id_seq OWNED BY public.form_format_versions.id;


--
-- Name: form_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_permissions (
    id integer NOT NULL,
    form_format_id integer NOT NULL,
    role_id integer,
    can_view boolean DEFAULT false,
    can_submit boolean DEFAULT false,
    can_edit boolean DEFAULT false,
    can_approve boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE form_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.form_permissions IS 'Role-based access control for organization forms. Controls which roles can view, submit, edit, and approve specific form types.';


--
-- Name: form_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.form_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: form_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.form_permissions_id_seq OWNED BY public.form_permissions.id;


--
-- Name: form_submission_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_submission_history (
    id integer NOT NULL,
    form_submission_id integer NOT NULL,
    submission_data jsonb NOT NULL,
    status character varying(20),
    edited_by uuid,
    edited_at timestamp without time zone DEFAULT now(),
    change_reason text,
    ip_address character varying(45),
    user_agent text,
    changes_summary jsonb
);


--
-- Name: TABLE form_submission_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.form_submission_history IS 'Audit trail for all changes to form submissions';


--
-- Name: COLUMN form_submission_history.changes_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.form_submission_history.changes_summary IS 'JSONB object tracking what fields changed';


--
-- Name: form_submission_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.form_submission_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: form_submission_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.form_submission_history_id_seq OWNED BY public.form_submission_history.id;


--
-- Name: form_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_submissions (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer,
    form_type character varying(50) NOT NULL,
    submission_data jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id uuid,
    form_version_id integer,
    status character varying(20) DEFAULT 'submitted'::character varying,
    reviewed_by uuid,
    reviewed_at timestamp without time zone,
    review_notes text,
    submitted_at timestamp without time zone,
    ip_address character varying(45),
    user_agent text,
    scout_year_id integer,
    review_state text DEFAULT 'current'::text NOT NULL,
    flagged_for_review_at timestamp with time zone,
    last_reviewed_at timestamp with time zone,
    last_reviewed_by uuid,
    CONSTRAINT form_submissions_review_state_check CHECK ((review_state = ANY (ARRAY['current'::text, 'needs_review'::text]))),
    CONSTRAINT form_submissions_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('submitted'::character varying)::text, ('reviewed'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text])))
);


--
-- Name: COLUMN form_submissions.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.form_submissions.user_id IS 'User who submitted the form (already exists)';


--
-- Name: COLUMN form_submissions.form_version_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.form_submissions.form_version_id IS 'Links submission to specific form version used';


--
-- Name: COLUMN form_submissions.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.form_submissions.status IS 'Submission workflow status';


--
-- Name: form_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.form_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: form_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.form_submissions_id_seq OWNED BY public.form_submissions.id;


--
-- Name: fundraisers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fundraisers (
    id bigint NOT NULL,
    name text,
    start_date date,
    end_date date,
    objective numeric,
    result numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization integer,
    archived boolean DEFAULT false NOT NULL,
    budget_category_id integer
);


--
-- Name: TABLE fundraisers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fundraisers IS 'Table to host fundraisers';


--
-- Name: fundraisers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fundraisers ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fundraisers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: google_chat_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_chat_config (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    service_account_email character varying(255) NOT NULL,
    credentials_json jsonb NOT NULL,
    project_id character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE google_chat_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.google_chat_config IS 'Stores Google Chat API configuration including service account credentials for each organization. One active configuration per organization.';


--
-- Name: COLUMN google_chat_config.service_account_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.google_chat_config.service_account_email IS 'Email address of the service account (e.g., my-bot@project-id.iam.gserviceaccount.com).';


--
-- Name: COLUMN google_chat_config.credentials_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.google_chat_config.credentials_json IS 'Service account key file in JSON format. Contains private key for authenticating with Google Chat API. Should be kept secure.';


--
-- Name: google_chat_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.google_chat_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: google_chat_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.google_chat_config_id_seq OWNED BY public.google_chat_config.id;


--
-- Name: google_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_chat_messages (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    space_id character varying(255) NOT NULL,
    message_id character varying(500),
    subject character varying(500),
    message_text text NOT NULL,
    sent_by_user_id uuid,
    sent_at timestamp without time zone DEFAULT now(),
    delivery_status character varying(50) DEFAULT 'sent'::character varying,
    error_message text
);


--
-- Name: TABLE google_chat_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.google_chat_messages IS 'Audit log of all messages sent through Google Chat API.';


--
-- Name: google_chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.google_chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: google_chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.google_chat_messages_id_seq OWNED BY public.google_chat_messages.id;


--
-- Name: google_chat_spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_chat_spaces (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    space_id character varying(255) NOT NULL,
    space_name character varying(255),
    space_type character varying(50) DEFAULT 'SPACE'::character varying,
    is_broadcast_space boolean DEFAULT false,
    is_active boolean DEFAULT true,
    member_count integer,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE google_chat_spaces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.google_chat_spaces IS 'Stores configured Google Chat Spaces for each organization.';


--
-- Name: COLUMN google_chat_spaces.space_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.google_chat_spaces.space_id IS 'Google Chat Space identifier in the format spaces/AAAAxxxxxxx.';


--
-- Name: COLUMN google_chat_spaces.is_broadcast_space; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.google_chat_spaces.is_broadcast_space IS 'Identifies the primary space for broadcasting announcements.';


--
-- Name: google_chat_spaces_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.google_chat_spaces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: google_chat_spaces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.google_chat_spaces_id_seq OWNED BY public.google_chat_spaces.id;


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id integer,
    section character varying(255) DEFAULT 'general'::character varying
);


--
-- Name: groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.groups_id_seq OWNED BY public.groups.id;


--
-- Name: guardian_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardian_users (
    guardian_id integer NOT NULL,
    user_id uuid,
    gu_id integer NOT NULL
);


--
-- Name: guardian_users_gu_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.guardian_users ALTER COLUMN gu_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.guardian_users_gu_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: parents_guardians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parents_guardians (
    id integer NOT NULL,
    nom character varying(255) NOT NULL,
    prenom character varying(255) NOT NULL,
    old_lien text,
    courriel character varying(255),
    telephone_residence character varying(20),
    telephone_travail character varying(20),
    telephone_cellulaire character varying(20),
    is_primary boolean,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_emergency_contact boolean,
    user_uuid uuid
);


--
-- Name: guardians_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guardians_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guardians_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guardians_id_seq OWNED BY public.parents_guardians.id;


--
-- Name: guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guests (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    attendance_date date NOT NULL,
    organization_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: guests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guests_id_seq OWNED BY public.guests.id;


--
-- Name: honors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.honors (
    id integer NOT NULL,
    participant_id integer NOT NULL,
    date date NOT NULL,
    organization_id integer,
    reason text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_at timestamp without time zone,
    updated_by uuid
);


--
-- Name: COLUMN honors.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.honors.reason IS 'Reason why the honor was given';


--
-- Name: COLUMN honors.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.honors.created_at IS 'Timestamp when honor was awarded (for undo time-window)';


--
-- Name: COLUMN honors.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.honors.created_by IS 'User ID who awarded the honor (audit trail)';


--
-- Name: COLUMN honors.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.honors.updated_at IS 'Timestamp of last edit';


--
-- Name: COLUMN honors.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.honors.updated_by IS 'User ID who last edited the honor';


--
-- Name: honors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.honors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: honors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.honors_id_seq OWNED BY public.honors.id;


--
-- Name: incident_email_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.incident_email_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incident_email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_email_queue (
    id integer DEFAULT nextval('public.incident_email_queue_id_seq'::regclass) NOT NULL,
    organization_id integer NOT NULL,
    incident_report_id integer NOT NULL,
    recipient_email character varying NOT NULL,
    recipient_name character varying,
    subject character varying NOT NULL,
    body_text text NOT NULL,
    body_html text,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 5,
    last_attempt_at timestamp with time zone,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT incident_email_queue_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('sending'::character varying)::text, ('sent'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: TABLE incident_email_queue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_email_queue IS 'Queue for incident escalation emails with offline retry support';


--
-- Name: COLUMN incident_email_queue.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_email_queue.attempts IS 'Number of send attempts made';


--
-- Name: COLUMN incident_email_queue.max_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_email_queue.max_attempts IS 'Maximum retry attempts before giving up (default 5)';


--
-- Name: incident_escalation_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.incident_escalation_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incident_escalation_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_escalation_contacts (
    id integer DEFAULT nextval('public.incident_escalation_contacts_id_seq'::regclass) NOT NULL,
    organization_id integer NOT NULL,
    email character varying NOT NULL,
    name character varying,
    role_description character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE incident_escalation_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_escalation_contacts IS 'Per-organization email contacts for incident escalation notifications';


--
-- Name: COLUMN incident_escalation_contacts.role_description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_escalation_contacts.role_description IS 'Role or title of the contact (e.g., District Commissioner, Safety Officer)';


--
-- Name: incident_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.incident_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incident_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_reports (
    id integer DEFAULT nextval('public.incident_reports_id_seq'::regclass) NOT NULL,
    organization_id integer NOT NULL,
    form_submission_id integer,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    victim_type character varying DEFAULT 'participant'::character varying NOT NULL,
    victim_participant_id integer,
    victim_user_id uuid,
    victim_name character varying,
    activity_id integer,
    incident_date date,
    incident_time time without time zone,
    incident_location text,
    escalation_sent_at timestamp with time zone,
    escalation_sent_to text[],
    created_by uuid NOT NULL,
    submitted_at timestamp with time zone,
    submitted_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT incident_reports_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('submitted'::character varying)::text]))),
    CONSTRAINT incident_reports_victim_type_check CHECK (((victim_type)::text = ANY (ARRAY[('participant'::character varying)::text, ('leader'::character varying)::text, ('parent'::character varying)::text, ('other'::character varying)::text])))
);


--
-- Name: TABLE incident_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_reports IS 'Tracks incident/accident reports with escalation workflow';


--
-- Name: COLUMN incident_reports.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.status IS 'Report status: draft or submitted';


--
-- Name: COLUMN incident_reports.victim_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.victim_type IS 'Type of victim: participant, leader, parent, or other';


--
-- Name: COLUMN incident_reports.escalation_sent_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.escalation_sent_to IS 'Snapshot of email addresses that received escalation notification';


--
-- Name: languages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.languages (
    id integer NOT NULL,
    code character varying(5) NOT NULL,
    name character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: languages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.languages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: languages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.languages_id_seq OWNED BY public.languages.id;


--
-- Name: local_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_groups (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    slug character varying(150) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: local_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.local_groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: local_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.local_groups_id_seq OWNED BY public.local_groups.id;


--
-- Name: medication_admin_authorization_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_admin_authorization_requirements (
    authorization_id integer CONSTRAINT medication_admin_authorization_requir_authorization_id_not_null NOT NULL,
    medication_requirement_id integer CONSTRAINT medication_admin_authorizati_medication_requirement_id_not_null NOT NULL,
    initiales character varying(20)
);


--
-- Name: medication_admin_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_admin_authorizations (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    guardian_id integer NOT NULL,
    admin_user_id_1 uuid,
    admin_user_id_2 uuid,
    deja_pris_a_la_maison boolean DEFAULT false,
    remettre_contenant_origine boolean DEFAULT false,
    etiquette_pharmacie_et_avis boolean DEFAULT false,
    reconnait_risques_et_accepte boolean DEFAULT false,
    nom_parent_ou_tuteur_legal character varying(200),
    signature_parent_ou_tuteur_legal text,
    date_signature timestamp with time zone,
    signature_type character varying(50) DEFAULT 'drawn'::character varying,
    status character varying(50) DEFAULT 'signed'::character varying,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    scout_year_id integer,
    expired_at timestamp with time zone
);


--
-- Name: medication_admin_authorizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medication_admin_authorizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medication_admin_authorizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medication_admin_authorizations_id_seq OWNED BY public.medication_admin_authorizations.id;


--
-- Name: medication_distributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_distributions (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    medication_requirement_id integer NOT NULL,
    participant_id integer NOT NULL,
    participant_medication_id integer,
    scheduled_for timestamp with time zone NOT NULL,
    activity_name character varying(200),
    dose_amount numeric(10,2),
    dose_unit character varying(50),
    dose_notes text,
    general_notice text,
    status character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    administered_at timestamp with time zone,
    administered_by uuid,
    witness_name character varying(150),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    reminder_sent_at timestamp without time zone,
    CONSTRAINT medication_distributions_status_check CHECK (((status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('given'::character varying)::text, ('missed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: medication_distributions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medication_distributions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medication_distributions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medication_distributions_id_seq OWNED BY public.medication_distributions.id;


--
-- Name: medication_receptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medication_receptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medication_receptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_receptions (
    id integer DEFAULT nextval('public.medication_receptions_id_seq'::regclass) NOT NULL,
    organization_id integer NOT NULL,
    activity_id integer,
    medication_requirement_id integer NOT NULL,
    participant_id integer NOT NULL,
    participant_medication_id integer,
    status character varying DEFAULT 'not_received'::character varying NOT NULL,
    quantity_received text,
    reception_notes text,
    received_by uuid,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT medication_receptions_status_check CHECK (((status)::text = ANY (ARRAY[('received'::character varying)::text, ('not_received'::character varying)::text, ('partial'::character varying)::text])))
);


--
-- Name: TABLE medication_receptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.medication_receptions IS 'Tracks when medications are received from parents/guardians at activities';


--
-- Name: COLUMN medication_receptions.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_receptions.status IS 'Reception status: received, not_received, or partial';


--
-- Name: COLUMN medication_receptions.quantity_received; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_receptions.quantity_received IS 'Free-text quantity (e.g., "1 bottle of 30 pills")';


--
-- Name: COLUMN medication_receptions.reception_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_receptions.reception_notes IS 'Notes visible during medication dispensing';


--
-- Name: medication_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_requirements (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    medication_name character varying(200) NOT NULL,
    dosage_instructions text,
    frequency_text character varying(120),
    route character varying(120),
    default_dose_amount numeric(10,2),
    default_dose_unit character varying(50),
    general_notes text,
    start_date date,
    end_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    frequency_preset_type character varying(30),
    frequency_times jsonb,
    frequency_slots jsonb,
    frequency_interval_hours integer,
    frequency_interval_start time without time zone,
    participant_id integer NOT NULL
);


--
-- Name: COLUMN medication_requirements.frequency_preset_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_requirements.frequency_preset_type IS 'Type of frequency preset: interval, time_of_day, meal, or prn';


--
-- Name: COLUMN medication_requirements.frequency_times; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_requirements.frequency_times IS 'Array of time strings (HH:MM) for time_of_day preset';


--
-- Name: COLUMN medication_requirements.frequency_slots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_requirements.frequency_slots IS 'JSON object mapping slot names to times for meal preset (e.g., {"breakfast": "08:00"})';


--
-- Name: COLUMN medication_requirements.frequency_interval_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_requirements.frequency_interval_hours IS 'Number of hours between doses for interval preset';


--
-- Name: COLUMN medication_requirements.frequency_interval_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.medication_requirements.frequency_interval_start IS 'Starting time for interval preset';


--
-- Name: medication_requirements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medication_requirements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medication_requirements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medication_requirements_id_seq OWNED BY public.medication_requirements.id;


--
-- Name: medication_treatment_authorization_supplies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_treatment_authorization_supplies (
    authorization_id integer CONSTRAINT medication_treatment_authorization_su_authorization_id_not_null NOT NULL,
    first_aid_supply_id integer CONSTRAINT medication_treatment_authorization_first_aid_supply_id_not_null NOT NULL,
    is_allowed boolean DEFAULT false
);


--
-- Name: medication_treatment_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medication_treatment_authorizations (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    guardian_id integer NOT NULL,
    autorise_gestes_securite_bien_etre boolean DEFAULT false,
    accepte_soins_medicaux_urgence boolean DEFAULT false,
    autorise_transmission_fiche_medicale boolean DEFAULT false,
    reconnait_responsabilite_aviser_changements_sante boolean DEFAULT false,
    signature_parent_tuteur text,
    nom_en_caractere_d_imprimerie character varying(200),
    date_signature timestamp with time zone,
    signature_type character varying(50) DEFAULT 'drawn'::character varying,
    status character varying(50) DEFAULT 'signed'::character varying,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    scout_year_id integer,
    expired_at timestamp with time zone
);


--
-- Name: medication_treatment_authorizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.medication_treatment_authorizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medication_treatment_authorizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medication_treatment_authorizations_id_seq OWNED BY public.medication_treatment_authorizations.id;


--
-- Name: names; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.names (
    id integer NOT NULL,
    first_name character varying(255) NOT NULL,
    group_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    participant_id integer
);


--
-- Name: names_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.names_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: names_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.names_id_seq OWNED BY public.names.id;


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id integer NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    date_naissance date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: new_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.new_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: new_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.new_participants_id_seq OWNED BY public.participants.id;


--
-- Name: news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id integer,
    expires date,
    link text
);


--
-- Name: COLUMN news.expires; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.news.expires IS 'Date to stop showing a news';


--
-- Name: news_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.news_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.news_id_seq OWNED BY public.news.id;


--
-- Name: oas_competencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oas_competencies (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    oas_skill_id bigint NOT NULL,
    oas_stage_id bigint,
    code character varying(100),
    name character varying(255) NOT NULL,
    description text,
    competency_order integer DEFAULT 1 NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: oas_competencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oas_competencies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oas_competencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oas_competencies_id_seq OWNED BY public.oas_competencies.id;


--
-- Name: oas_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oas_skills (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    code character varying(100),
    name character varying(255) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: oas_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oas_skills_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oas_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oas_skills_id_seq OWNED BY public.oas_skills.id;


--
-- Name: oas_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oas_stages (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    oas_skill_id bigint NOT NULL,
    stage_order integer DEFAULT 1 NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: oas_stages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oas_stages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oas_stages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oas_stages_id_seq OWNED BY public.oas_stages.id;


--
-- Name: objective_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objective_achievements (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    objective_id integer NOT NULL,
    participant_id integer NOT NULL,
    meeting_id integer,
    achieved_date date NOT NULL,
    attribution_source character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT objective_achievements_attribution_source_check CHECK (((attribution_source)::text = ANY (ARRAY[('auto'::character varying)::text, ('manual'::character varying)::text])))
);


--
-- Name: objective_achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.objective_achievements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: objective_achievements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.objective_achievements_id_seq OWNED BY public.objective_achievements.id;


--
-- Name: organization_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_domains (
    id integer NOT NULL,
    organization_id integer,
    domain character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: organization_domains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organization_domains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: organization_domains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organization_domains_id_seq OWNED BY public.organization_domains.id;


--
-- Name: organization_form_formats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_form_formats (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    form_type character varying(50) NOT NULL,
    form_structure jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    display_type text,
    display_name character varying(255),
    description text,
    instructions text,
    category character varying(100),
    status character varying(20) DEFAULT 'draft'::character varying,
    published_at timestamp without time zone,
    archived_at timestamp without time zone,
    valid_from timestamp without time zone,
    valid_until timestamp without time zone,
    max_submissions_per_participant integer,
    is_required boolean DEFAULT false,
    display_order integer DEFAULT 0,
    tags text[],
    created_by uuid,
    current_version_id integer,
    display_context text[] DEFAULT ARRAY['participant'::text],
    CONSTRAINT organization_form_formats_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('published'::character varying)::text, ('archived'::character varying)::text]))),
    CONSTRAINT valid_display_contexts CHECK ((display_context <@ ARRAY['participant'::text, 'organization'::text, 'admin_panel'::text, 'public'::text, 'form_builder'::text]))
);


--
-- Name: COLUMN organization_form_formats.display_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_form_formats.display_type IS 'Sets where the form should be rendered';


--
-- Name: COLUMN organization_form_formats.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_form_formats.display_name IS 'Human-readable name for the form';


--
-- Name: COLUMN organization_form_formats.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_form_formats.status IS 'Form lifecycle: draft, published, archived';


--
-- Name: COLUMN organization_form_formats.current_version_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_form_formats.current_version_id IS 'Points to the currently active version';


--
-- Name: COLUMN organization_form_formats.display_context; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_form_formats.display_context IS 'UI contexts where this form should be displayed. Values: participant, organization, admin_panel, public, form_builder';


--
-- Name: organization_form_formats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organization_form_formats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: organization_form_formats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organization_form_formats_id_seq OWNED BY public.organization_form_formats.id;


--
-- Name: organization_local_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_local_groups (
    organization_id integer NOT NULL,
    local_group_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_program_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_program_sections (
    organization_id integer NOT NULL,
    section_key text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT organization_program_sections_key_not_empty CHECK ((length(btrim(section_key)) > 0)),
    CONSTRAINT organization_program_sections_label_not_empty CHECK ((length(btrim(display_name)) > 0))
);


--
-- Name: organization_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_settings (
    id integer NOT NULL,
    organization_id integer,
    setting_key character varying(255) NOT NULL,
    setting_value jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE organization_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_settings IS 'Stores organization-level settings including default_email_language (supported: en, fr, uk, it)';


--
-- Name: organization_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organization_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: organization_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organization_settings_id_seq OWNED BY public.organization_settings.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    api_key uuid DEFAULT gen_random_uuid() NOT NULL,
    program_section text DEFAULT 'general'::text NOT NULL,
    default_language text DEFAULT 'fr'::text NOT NULL
);


--
-- Name: organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organizations_id_seq OWNED BY public.organizations.id;


--
-- Name: pab_plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pab_plan_items (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    pab_plan_id bigint NOT NULL,
    item_order integer DEFAULT 1 NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    due_date date,
    completed_at timestamp with time zone,
    evidence text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT pab_plan_items_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('in_progress'::character varying)::text, ('done'::character varying)::text, ('skipped'::character varying)::text])))
);


--
-- Name: pab_plan_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pab_plan_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pab_plan_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pab_plan_items_id_seq OWNED BY public.pab_plan_items.id;


--
-- Name: pab_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pab_plans (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    pab_theme_id bigint,
    title character varying(255) NOT NULL,
    objective text,
    status character varying(30) DEFAULT 'planned'::character varying NOT NULL,
    planned_start_date date,
    planned_end_date date,
    completed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT pab_plans_status_check CHECK (((status)::text = ANY (ARRAY[('planned'::character varying)::text, ('in_progress'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: pab_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pab_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pab_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pab_plans_id_seq OWNED BY public.pab_plans.id;


--
-- Name: pab_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pab_reviews (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    pab_plan_id bigint NOT NULL,
    participant_id integer NOT NULL,
    reviewer_user_id uuid,
    review_date date DEFAULT CURRENT_DATE NOT NULL,
    rating integer,
    notes text,
    next_steps text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT pab_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: pab_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pab_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pab_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pab_reviews_id_seq OWNED BY public.pab_reviews.id;


--
-- Name: pab_themes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pab_themes (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    code character varying(100),
    name character varying(255) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: pab_themes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pab_themes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pab_themes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pab_themes_id_seq OWNED BY public.pab_themes.id;


--
-- Name: participant_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_credentials (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    credential_key character varying(150) NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    issued_at timestamp with time zone,
    expires_at timestamp with time zone,
    verified_by uuid,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT participant_credentials_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('expired'::character varying)::text, ('revoked'::character varying)::text, ('pending'::character varying)::text])))
);


--
-- Name: participant_credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participant_credentials_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participant_credentials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participant_credentials_id_seq OWNED BY public.participant_credentials.id;


--
-- Name: participant_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_enrollments (
    participant_id integer CONSTRAINT participant_organizations_participant_id_not_null NOT NULL,
    organization_id integer CONSTRAINT participant_organizations_organization_id_not_null NOT NULL,
    inscription_date date,
    scout_year_id integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    ended_on date,
    exit_reason text,
    exception_note text,
    transferred_to_organization_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT participant_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'graduated'::text, 'left'::text, 'transferred'::text])))
);


--
-- Name: COLUMN participant_enrollments.inscription_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.participant_enrollments.inscription_date IS 'Date à laquelle le participant a joint l''organisation';


--
-- Name: participant_fees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_fees (
    id integer NOT NULL,
    participant_id integer NOT NULL,
    organization_id integer NOT NULL,
    fee_definition_id integer NOT NULL,
    total_registration_fee numeric(10,2) NOT NULL,
    total_membership_fee numeric(10,2) NOT NULL,
    total_amount numeric(10,2) GENERATED ALWAYS AS ((total_registration_fee + total_membership_fee)) STORED,
    status character varying(20) DEFAULT 'unpaid'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: participant_fees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participant_fees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participant_fees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participant_fees_id_seq OWNED BY public.participant_fees.id;


--
-- Name: participant_group_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_group_assignments (
    participant_id integer CONSTRAINT participant_groups_participant_id_not_null NOT NULL,
    group_id integer,
    organization_id integer CONSTRAINT participant_groups_organization_id_not_null NOT NULL,
    first_leader boolean DEFAULT false CONSTRAINT participant_groups_first_leader_not_null NOT NULL,
    second_leader boolean DEFAULT false CONSTRAINT participant_groups_second_leader_not_null NOT NULL,
    roles text,
    scout_year_id integer NOT NULL
);


--
-- Name: TABLE participant_group_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.participant_group_assignments IS 'Which den a participant belonged to in a given scout year, with their den role. One row per participant per year; assignments are not carried over by a year transition.';


--
-- Name: participant_groups; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.participant_groups AS
 SELECT pga.participant_id,
    pga.group_id,
    pga.organization_id,
    pga.first_leader,
    pga.second_leader,
    pga.roles
   FROM (public.participant_group_assignments pga
     JOIN public.scout_years sy ON ((sy.id = pga.scout_year_id)))
  WHERE (sy.status = 'active'::text);


--
-- Name: VIEW participant_groups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.participant_groups IS 'Compatibility view over participant_group_assignments, restricted to the active scout year. New code should write to participant_group_assignments directly.';


--
-- Name: participant_guardians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_guardians (
    guardian_id integer NOT NULL,
    participant_id integer NOT NULL,
    lien character varying(50)
);


--
-- Name: participant_medications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_medications (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    medication_requirement_id integer NOT NULL,
    participant_id integer NOT NULL,
    participant_notes text,
    custom_dosage text,
    custom_frequency text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: participant_medications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participant_medications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participant_medications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participant_medications_id_seq OWNED BY public.participant_medications.id;


--
-- Name: participant_oas_competency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_oas_competency (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    oas_competency_id bigint NOT NULL,
    status character varying(30) DEFAULT 'awarded'::character varying NOT NULL,
    achieved_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    awarded_by uuid,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT participant_oas_competency_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('awarded'::character varying)::text, ('revoked'::character varying)::text])))
);


--
-- Name: participant_oas_competency_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participant_oas_competency_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participant_oas_competency_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participant_oas_competency_id_seq OWNED BY public.participant_oas_competency.id;


--
-- Name: participant_oas_stage_award; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_oas_stage_award (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    oas_stage_id bigint NOT NULL,
    status character varying(30) DEFAULT 'awarded'::character varying NOT NULL,
    achieved_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    awarded_by uuid,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT participant_oas_stage_award_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('awarded'::character varying)::text, ('revoked'::character varying)::text])))
);


--
-- Name: participant_oas_stage_award_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participant_oas_stage_award_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participant_oas_stage_award_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participant_oas_stage_award_id_seq OWNED BY public.participant_oas_stage_award.id;


--
-- Name: participant_organizations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.participant_organizations AS
 SELECT pe.participant_id,
    pe.organization_id,
    pe.inscription_date
   FROM (public.participant_enrollments pe
     JOIN public.scout_years sy ON ((sy.id = pe.scout_year_id)))
  WHERE ((sy.status = 'active'::text) AND (pe.status = 'active'::text));


--
-- Name: VIEW participant_organizations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.participant_organizations IS 'Compatibility view over participant_enrollments, restricted to the active scout year. New code should write to participant_enrollments directly; INSTEAD OF triggers keep older deployments working.';


--
-- Name: participant_top_award_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_top_award_progress (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    top_award_id bigint NOT NULL,
    status character varying(30) DEFAULT 'in_progress'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    target_date date,
    completed_at timestamp with time zone,
    progress_percent numeric(5,2) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT participant_top_award_progress_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('submitted'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('completed'::character varying)::text])))
);


--
-- Name: participant_top_award_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participant_top_award_progress_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participant_top_award_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participant_top_award_progress_id_seq OWNED BY public.participant_top_award_progress.id;


--
-- Name: payment_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plans (
    id integer NOT NULL,
    participant_fee_id integer NOT NULL,
    number_of_payments integer NOT NULL,
    amount_per_payment numeric(10,2) NOT NULL,
    start_date date NOT NULL,
    frequency character varying(20) NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: payment_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_plans_id_seq OWNED BY public.payment_plans.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    participant_fee_id integer NOT NULL,
    payment_plan_id integer,
    amount numeric(10,2) NOT NULL,
    payment_date date NOT NULL,
    method character varying(20),
    reference_number character varying(255),
    created_at timestamp without time zone DEFAULT now(),
    stripe_payment_intent_id character varying(255),
    stripe_payment_method_id character varying(255),
    stripe_transaction_id character varying(255),
    stripe_payment_status character varying(50),
    stripe_metadata jsonb DEFAULT '{}'::jsonb,
    payment_processor character varying(50) DEFAULT 'manual'::character varying
);


--
-- Name: COLUMN payments.stripe_payment_intent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.stripe_payment_intent_id IS 'Stripe PaymentIntent ID for tracking payments';


--
-- Name: COLUMN payments.stripe_payment_method_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.stripe_payment_method_id IS 'Stripe PaymentMethod ID used for payment';


--
-- Name: COLUMN payments.stripe_transaction_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.stripe_transaction_id IS 'Stripe transaction/charge ID';


--
-- Name: COLUMN payments.stripe_payment_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.stripe_payment_status IS 'Stripe payment status: requires_payment_method, requires_confirmation, requires_action, processing, requires_capture, canceled, succeeded';


--
-- Name: COLUMN payments.stripe_metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.stripe_metadata IS 'Additional Stripe metadata and response data';


--
-- Name: COLUMN payments.payment_processor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.payment_processor IS 'Payment processor used: manual, stripe, etc.';


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: permission_slips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_slips (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer NOT NULL,
    guardian_id integer,
    meeting_id integer,
    meeting_date date NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    consent_payload jsonb DEFAULT '{}'::jsonb,
    signed_at timestamp with time zone,
    signed_by text,
    signature_hash text,
    contact_confirmation jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    activity_title character varying(200),
    activity_description text,
    deadline_date timestamp with time zone,
    email_sent boolean DEFAULT false,
    email_sent_at timestamp with time zone,
    reminder_sent boolean DEFAULT false,
    reminder_sent_at timestamp with time zone,
    access_token uuid DEFAULT gen_random_uuid(),
    activity_id integer,
    guardians_emailed jsonb DEFAULT '[]'::jsonb,
    declined_at timestamp with time zone,
    declined_by text,
    CONSTRAINT permission_slips_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('signed'::character varying)::text, ('declined'::character varying)::text, ('revoked'::character varying)::text, ('expired'::character varying)::text, ('archived'::character varying)::text])))
);


--
-- Name: COLUMN permission_slips.activity_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_slips.activity_title IS 'Title of the activity requiring permission';


--
-- Name: COLUMN permission_slips.activity_description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_slips.activity_description IS 'Rich text description of the activity (supports HTML from WYSIWYG editor)';


--
-- Name: COLUMN permission_slips.deadline_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_slips.deadline_date IS 'Deadline for parent to sign the permission slip';


--
-- Name: COLUMN permission_slips.email_sent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_slips.email_sent IS 'Whether notification email has been sent to parent';


--
-- Name: COLUMN permission_slips.email_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_slips.email_sent_at IS 'Timestamp when notification email was sent';


--
-- Name: COLUMN permission_slips.reminder_sent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_slips.reminder_sent IS 'Whether reminder email has been sent';


--
-- Name: COLUMN permission_slips.reminder_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.permission_slips.reminder_sent_at IS 'Timestamp when reminder email was sent';


--
-- Name: permission_slips_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permission_slips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permission_slips_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permission_slips_id_seq OWNED BY public.permission_slips.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id integer NOT NULL,
    permission_key character varying(100) NOT NULL,
    permission_name character varying(100) NOT NULL,
    category character varying(50) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;


--
-- Name: points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.points_id_seq OWNED BY public.points.id;


--
-- Name: processed_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_transactions (
    id integer NOT NULL,
    transaction_id character varying(255) NOT NULL,
    processed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: processed_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.processed_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: processed_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.processed_transactions_id_seq OWNED BY public.processed_transactions.id;


--
-- Name: profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile (
    email text NOT NULL,
    password character varying(255) NOT NULL,
    is_verified boolean DEFAULT false,
    verification_token character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    role text,
    full_name character varying(255),
    reset_token character varying(64),
    reset_token_expiry timestamp with time zone,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supabase_user_id uuid,
    token_version integer DEFAULT 0
);


--
-- Name: TABLE profile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profile IS 'This is a duplicate of users';


--
-- Name: COLUMN profile.supabase_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profile.supabase_user_id IS 'To reconcole logins';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    email text NOT NULL,
    password character varying(255) NOT NULL,
    is_verified boolean DEFAULT false,
    verification_token character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    role text,
    full_name character varying(255),
    reset_token character varying(64),
    reset_token_expiry timestamp with time zone,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid NOT NULL,
    token_version integer DEFAULT 0
);


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS 'This is a duplicate of users';


--
-- Name: COLUMN profiles.auth_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.auth_user_id IS 'To reconcole logins';


--
-- Name: program_catalog_competencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_catalog_competencies (
    id bigint NOT NULL,
    program text NOT NULL,
    version text NOT NULL,
    code text NOT NULL,
    official_key text NOT NULL,
    stage_no integer NOT NULL,
    text_en text NOT NULL,
    text_fr text NOT NULL,
    display_order integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: program_catalog_competencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.program_catalog_competencies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: program_catalog_competencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.program_catalog_competencies_id_seq OWNED BY public.program_catalog_competencies.id;


--
-- Name: program_catalog_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_catalog_rules (
    id bigint NOT NULL,
    program text NOT NULL,
    version text NOT NULL,
    rules_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: program_catalog_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.program_catalog_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: program_catalog_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.program_catalog_rules_id_seq OWNED BY public.program_catalog_rules.id;


--
-- Name: program_catalog_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_catalog_skills (
    id bigint NOT NULL,
    program text NOT NULL,
    version text NOT NULL,
    official_key text NOT NULL,
    name text NOT NULL,
    display_order integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: program_catalog_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.program_catalog_skills_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: program_catalog_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.program_catalog_skills_id_seq OWNED BY public.program_catalog_skills.id;


--
-- Name: program_catalog_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_catalog_stages (
    id bigint NOT NULL,
    program text NOT NULL,
    version text NOT NULL,
    stage_no integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    display_order integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: program_catalog_stages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.program_catalog_stages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: program_catalog_stages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.program_catalog_stages_id_seq OWNED BY public.program_catalog_stages.id;


--
-- Name: program_catalog_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_catalog_versions (
    id bigint NOT NULL,
    program text NOT NULL,
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    checksum text NOT NULL,
    source_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: program_catalog_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.program_catalog_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: program_catalog_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.program_catalog_versions_id_seq OWNED BY public.program_catalog_versions.id;


--
-- Name: progress_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.progress_approvals (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer,
    source_type character varying(100) NOT NULL,
    source_id bigint NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT progress_approvals_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text])))
);


--
-- Name: progress_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.progress_approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: progress_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.progress_approvals_id_seq OWNED BY public.progress_approvals.id;


--
-- Name: progress_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.progress_evidence (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_id integer,
    source_type character varying(100) NOT NULL,
    source_id bigint NOT NULL,
    evidence_type character varying(50) DEFAULT 'note'::character varying NOT NULL,
    evidence_url text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: progress_evidence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.progress_evidence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: progress_evidence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.progress_evidence_id_seq OWNED BY public.progress_evidence.id;


--
-- Name: rappel_reunion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rappel_reunion (
    id integer NOT NULL,
    creation_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reminder_date date NOT NULL,
    organization_id integer NOT NULL,
    is_recurring boolean DEFAULT false,
    reminder_text text NOT NULL
);


--
-- Name: rappel_reunion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rappel_reunion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rappel_reunion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rappel_reunion_id_seq OWNED BY public.rappel_reunion.id;


--
-- Name: reunion_preparations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reunion_preparations (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    date date NOT NULL,
    youth_of_honor text,
    endroit text NOT NULL,
    activities jsonb NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    animateur_responsable uuid,
    duration_override integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT reunion_preparations_duration_override_check CHECK (((duration_override IS NULL) OR (duration_override > 0)))
);


--
-- Name: reunion_preparations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reunion_preparations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reunion_preparations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reunion_preparations_id_seq OWNED BY public.reunion_preparations.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id integer NOT NULL,
    permission_id integer NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    role_name character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    is_system_role boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    data_scope character varying(50) DEFAULT 'organization'::character varying
);


--
-- Name: COLUMN roles.data_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.data_scope IS 'Data access scope: ''organization'' (all data) or ''linked'' (linked data only)';


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: scout_year_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_year_transitions (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    from_scout_year_id integer,
    to_scout_year_id integer NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    executed_by uuid,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    changeset jsonb DEFAULT '{}'::jsonb NOT NULL,
    rolled_back_at timestamp with time zone,
    rolled_back_by uuid
);


--
-- Name: scout_year_transitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scout_year_transitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scout_year_transitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scout_year_transitions_id_seq OWNED BY public.scout_year_transitions.id;


--
-- Name: scout_years_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scout_years_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scout_years_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scout_years_id_seq OWNED BY public.scout_years.id;


--
-- Name: subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscribers (
    id integer NOT NULL,
    endpoint text NOT NULL,
    expiration_time timestamp without time zone,
    p256dh text,
    auth text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id integer,
    user_id uuid
);


--
-- Name: subscribers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscribers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscribers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscribers_id_seq OWNED BY public.subscribers.id;


--
-- Name: sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_log (
    id integer NOT NULL,
    action character varying(255) NOT NULL,
    data jsonb NOT NULL,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    synced boolean DEFAULT false
);


--
-- Name: sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_log_id_seq OWNED BY public.sync_log.id;


--
-- Name: top_award_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.top_award_projects (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_top_award_progress_id bigint NOT NULL,
    participant_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT top_award_projects_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('in_progress'::character varying)::text, ('submitted'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('completed'::character varying)::text])))
);


--
-- Name: top_award_projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.top_award_projects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: top_award_projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.top_award_projects_id_seq OWNED BY public.top_award_projects.id;


--
-- Name: top_award_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.top_award_reviews (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_top_award_progress_id bigint NOT NULL,
    participant_id integer NOT NULL,
    reviewer_user_id uuid,
    review_date date DEFAULT CURRENT_DATE NOT NULL,
    outcome character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT top_award_reviews_outcome_check CHECK (((outcome)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('revisions_required'::character varying)::text])))
);


--
-- Name: top_award_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.top_award_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: top_award_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.top_award_reviews_id_seq OWNED BY public.top_award_reviews.id;


--
-- Name: top_award_service_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.top_award_service_logs (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    participant_top_award_progress_id bigint CONSTRAINT top_award_service_logs_participant_top_award_progress__not_null NOT NULL,
    participant_id integer NOT NULL,
    service_date date NOT NULL,
    hours numeric(6,2) DEFAULT 0 NOT NULL,
    description text,
    status character varying(30) DEFAULT 'logged'::character varying NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT top_award_service_logs_status_check CHECK (((status)::text = ANY (ARRAY[('logged'::character varying)::text, ('submitted'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text])))
);


--
-- Name: top_award_service_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.top_award_service_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: top_award_service_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.top_award_service_logs_id_seq OWNED BY public.top_award_service_logs.id;


--
-- Name: top_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.top_awards (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    code character varying(100),
    name character varying(255) NOT NULL,
    description text,
    requirements jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: top_awards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.top_awards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: top_awards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.top_awards_id_seq OWNED BY public.top_awards.id;


--
-- Name: translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.translations (
    id integer NOT NULL,
    language_id integer,
    key character varying(255) NOT NULL,
    value text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: translations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.translations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: translations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.translations_id_seq OWNED BY public.translations.id;


--
-- Name: trusted_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trusted_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id integer NOT NULL,
    device_token character varying(255) NOT NULL,
    device_name text,
    device_fingerprint character varying(255),
    last_used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: TABLE trusted_devices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trusted_devices IS 'Stores trusted device tokens for users who have completed 2FA. Devices remain trusted for 90 days.';


--
-- Name: COLUMN trusted_devices.device_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trusted_devices.device_token IS 'Unique token stored in client localStorage to identify trusted devices';


--
-- Name: COLUMN trusted_devices.device_fingerprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trusted_devices.device_fingerprint IS 'Hash of user-agent string for additional device verification';


--
-- Name: COLUMN trusted_devices.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trusted_devices.expires_at IS 'Device trust expires after 90 days of inactivity';


--
-- Name: two_factor_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.two_factor_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id integer NOT NULL,
    code character varying(6) NOT NULL,
    code_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address character varying(45),
    user_agent text
);


--
-- Name: TABLE two_factor_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.two_factor_codes IS 'Stores temporary 2FA verification codes sent via email. Codes expire after 10 minutes.';


--
-- Name: COLUMN two_factor_codes.code_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.two_factor_codes.code_hash IS 'SHA256 hash of the verification code for secure storage';


--
-- Name: COLUMN two_factor_codes.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.two_factor_codes.attempts IS 'Number of verification attempts (max 5 allowed)';


--
-- Name: user_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_organizations (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id uuid,
    role_ids jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_reason text,
    last_active_scout_year_id integer,
    CONSTRAINT user_organizations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'alumni'::text])))
);


--
-- Name: user_organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_organizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_organizations_id_seq OWNED BY public.user_organizations.id;


--
-- Name: user_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_participants (
    participant_id integer NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: user_permissions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_permissions WITH (security_invoker='on') AS
 SELECT uo.user_id,
    uo.organization_id,
    r.role_name,
    r.display_name AS role_display_name,
    p.permission_key,
    p.permission_name,
    p.category AS permission_category
   FROM ((((public.user_organizations uo
     CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) role_id_text(value))
     JOIN public.roles r ON ((r.id = (role_id_text.value)::integer)))
     JOIN public.role_permissions rp ON ((rp.role_id = r.id)))
     JOIN public.permissions p ON ((p.id = rp.permission_id)));


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    email text NOT NULL,
    password character varying(255) NOT NULL,
    is_verified boolean DEFAULT false,
    verification_token character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    full_name character varying(255),
    reset_token character varying(64),
    reset_token_expiry timestamp with time zone,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supabase_user_id uuid,
    token_version integer DEFAULT 0,
    language_preference character varying(10),
    whatsapp_phone_number character varying(20)
);


--
-- Name: COLUMN users.supabase_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.supabase_user_id IS 'To reconcole logins';


--
-- Name: COLUMN users.language_preference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.language_preference IS 'User preferred language for email communications. Supported: en, fr, uk, it. NULL inherits from organization default.';


--
-- Name: COLUMN users.whatsapp_phone_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.whatsapp_phone_number IS 'User WhatsApp phone number in E.164 format (e.g., +1234567890) for WhatsApp notifications. NULL if user has not opted in to WhatsApp communications.';


--
-- Name: user_role_permissions_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_role_permissions_summary WITH (security_invoker='on') AS
 SELECT uo.organization_id,
    u.id AS user_id,
    u.full_name,
    COALESCE(ARRAY( SELECT DISTINCT r.role_name
           FROM (jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) role_id_text(role_id)
             JOIN public.roles r ON ((r.id = (role_id_text.role_id)::integer)))
          WHERE (r.role_name IS NOT NULL)
          ORDER BY r.role_name), (ARRAY[]::text[])::character varying[]) AS roles,
    COALESCE(ARRAY( SELECT DISTINCT p.permission_key
           FROM ((jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) role_id_text(role_id)
             JOIN public.role_permissions rp ON ((rp.role_id = (role_id_text.role_id)::integer)))
             JOIN public.permissions p ON ((p.id = rp.permission_id)))
          ORDER BY p.permission_key), (ARRAY[]::text[])::character varying[]) AS permissions
   FROM (public.users u
     JOIN public.user_organizations uo ON ((u.id = uo.user_id)));


--
-- Name: VIEW user_role_permissions_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.user_role_permissions_summary IS 'Summarizes each user''s full name, role names, and aggregated permission keys by organization. Updated to use only role_ids JSONB column.';


--
-- Name: v_active_forms; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_active_forms WITH (security_invoker='on') AS
 SELECT off.id,
    off.organization_id,
    off.form_type,
    off.display_name,
    off.description,
    off.category,
    off.status,
    off.display_order,
    ffv.id AS version_id,
    ffv.version_number,
    ffv.form_structure,
    ffv.created_at AS version_created_at,
    off.created_at,
    off.updated_at
   FROM (public.organization_form_formats off
     LEFT JOIN public.form_format_versions ffv ON ((off.current_version_id = ffv.id)))
  WHERE ((off.status)::text = 'published'::text);


--
-- Name: v_budget_revenue; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_budget_revenue WITH (security_invoker='on') AS
 SELECT pf.organization_id,
    bc.id AS budget_category_id,
    bc.name AS category_name,
    'participant_fee'::text AS revenue_source,
    py.payment_date AS revenue_date,
    py.amount,
    (((p.first_name)::text || ' '::text) || (p.last_name)::text) AS participant_name,
    py.id AS source_id
   FROM ((((public.payments py
     JOIN public.participant_fees pf ON ((py.participant_fee_id = pf.id)))
     JOIN public.participants p ON ((pf.participant_id = p.id)))
     LEFT JOIN public.fee_definitions fd ON ((pf.fee_definition_id = fd.id)))
     LEFT JOIN public.budget_categories bc ON ((fd.budget_category_id = bc.id)))
UNION ALL
 SELECT f.organization AS organization_id,
    f.budget_category_id,
    bc.name AS category_name,
    'fundraiser'::text AS revenue_source,
    COALESCE(f.end_date, f.start_date) AS revenue_date,
    f.result AS amount,
    f.name AS participant_name,
    f.id AS source_id
   FROM (public.fundraisers f
     LEFT JOIN public.budget_categories bc ON ((f.budget_category_id = bc.id)))
  WHERE ((f.result IS NOT NULL) AND (f.result > (0)::numeric))
UNION ALL
 SELECT f.organization AS organization_id,
    f.budget_category_id,
    bc.name AS category_name,
    'calendar_sale'::text AS revenue_source,
    (c.updated_at)::date AS revenue_date,
    c.amount_paid AS amount,
    (((p.first_name)::text || ' '::text) || (p.last_name)::text) AS participant_name,
    c.id AS source_id
   FROM (((public.fundraiser_entries c
     JOIN public.participants p ON ((c.participant_id = p.id)))
     LEFT JOIN public.fundraisers f ON ((c.fundraiser = f.id)))
     LEFT JOIN public.budget_categories bc ON ((f.budget_category_id = bc.id)))
  WHERE (c.amount_paid > (0)::double precision)
UNION ALL
 SELECT br.organization_id,
    br.budget_category_id,
    bc.name AS category_name,
    'external'::text AS revenue_source,
    br.revenue_date,
    br.amount,
    br.description AS participant_name,
    br.id AS source_id
   FROM (public.budget_revenues br
     LEFT JOIN public.budget_categories bc ON ((br.budget_category_id = bc.id)));


--
-- Name: VIEW v_budget_revenue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_budget_revenue IS 'Every revenue line of an organization. Participant fees are attributed through participant_fees.organization_id, never through an enrollment: a participant has one enrollment per scout year, and joining them would count each payment once per year.';


--
-- Name: v_budget_summary_by_category; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_budget_summary_by_category WITH (security_invoker='on') AS
 WITH revenue AS (
         SELECT v.organization_id,
            v.budget_category_id,
            v.category_name,
            sum(v.amount) AS total_revenue
           FROM public.v_budget_revenue v
          GROUP BY v.organization_id, v.budget_category_id, v.category_name
        ), expenses AS (
         SELECT be.organization_id,
            be.budget_category_id,
            bc.name AS category_name,
            sum(be.amount) AS total_expense
           FROM (public.budget_expenses be
             LEFT JOIN public.budget_categories bc ON ((be.budget_category_id = bc.id)))
          GROUP BY be.organization_id, be.budget_category_id, bc.name
        )
 SELECT COALESCE(r.organization_id, e.organization_id) AS organization_id,
    COALESCE(r.budget_category_id, e.budget_category_id) AS budget_category_id,
    COALESCE(r.category_name, e.category_name) AS category_name,
    COALESCE(r.total_revenue, (0)::double precision) AS total_revenue,
    COALESCE(e.total_expense, (0)::numeric) AS total_expense,
    (COALESCE(r.total_revenue, (0)::double precision) - (COALESCE(e.total_expense, (0)::numeric))::double precision) AS net_amount
   FROM (revenue r
     FULL JOIN expenses e ON (((r.organization_id = e.organization_id) AND (COALESCE(r.budget_category_id, 0) = COALESCE(e.budget_category_id, 0)))));


--
-- Name: v_form_submission_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_form_submission_stats WITH (security_invoker='on') AS
 SELECT organization_id,
    form_type,
    count(*) AS total_submissions,
    count(DISTINCT participant_id) AS unique_participants,
    count(
        CASE
            WHEN ((status)::text = 'draft'::text) THEN 1
            ELSE NULL::integer
        END) AS drafts,
    count(
        CASE
            WHEN ((status)::text = 'submitted'::text) THEN 1
            ELSE NULL::integer
        END) AS submitted,
    count(
        CASE
            WHEN ((status)::text = 'approved'::text) THEN 1
            ELSE NULL::integer
        END) AS approved,
    count(
        CASE
            WHEN ((status)::text = 'rejected'::text) THEN 1
            ELSE NULL::integer
        END) AS rejected,
    max(created_at) AS last_submission_at
   FROM public.form_submissions fs
  GROUP BY organization_id, form_type;


--
-- Name: whatsapp_baileys_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_baileys_connections (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    is_connected boolean DEFAULT false,
    connected_phone_number character varying(20),
    session_data text,
    last_connected_at timestamp without time zone,
    last_disconnected_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    auth_creds jsonb DEFAULT '{}'::jsonb,
    auth_keys jsonb DEFAULT '{}'::jsonb
);


--
-- Name: TABLE whatsapp_baileys_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_baileys_connections IS 'Stores WhatsApp connection status and session data for organizations using Baileys (unofficial WhatsApp Web API). One connection per organization.';


--
-- Name: COLUMN whatsapp_baileys_connections.connected_phone_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_baileys_connections.connected_phone_number IS 'The phone number of the WhatsApp account that was connected via QR code scan, in E.164 format.';


--
-- Name: COLUMN whatsapp_baileys_connections.session_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_baileys_connections.session_data IS 'Encrypted Baileys session credentials stored as base64 encoded JSON. Contains authentication tokens and keys needed to maintain the WhatsApp connection.';


--
-- Name: COLUMN whatsapp_baileys_connections.auth_creds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_baileys_connections.auth_creds IS 'Baileys authentication credentials stored as JSONB. Contains creds.json data including registration ID, identity keys, etc.';


--
-- Name: COLUMN whatsapp_baileys_connections.auth_keys; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_baileys_connections.auth_keys IS 'Baileys authentication keys stored as JSONB. Contains pre-keys, session keys, sender keys, and app state sync keys.';


--
-- Name: whatsapp_baileys_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_baileys_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_baileys_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_baileys_connections_id_seq OWNED BY public.whatsapp_baileys_connections.id;


--
-- Name: year_plan_meeting_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.year_plan_meeting_activities (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    meeting_id integer NOT NULL,
    activity_library_id integer,
    name character varying(255) NOT NULL,
    description text,
    duration_minutes integer,
    sort_order integer DEFAULT 0 NOT NULL,
    objective_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    series_id character varying(100),
    series_occurrence integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    start_time time without time zone,
    activity_type character varying(100),
    responsable character varying(255),
    material text,
    is_default boolean DEFAULT false NOT NULL,
    badge_template_id integer,
    processed boolean DEFAULT false NOT NULL
);


--
-- Name: year_plan_meeting_activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.year_plan_meeting_activities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: year_plan_meeting_activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.year_plan_meeting_activities_id_seq OWNED BY public.year_plan_meeting_activities.id;


--
-- Name: year_plan_meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.year_plan_meetings (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    year_plan_id integer,
    period_id integer,
    meeting_date date NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    duration_minutes integer,
    location text,
    theme character varying(255),
    notes text,
    is_cancelled boolean DEFAULT false NOT NULL,
    anchor_id character varying(100),
    reunion_preparation_id integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    youth_of_honor jsonb DEFAULT '[]'::jsonb NOT NULL,
    animateur_responsable uuid,
    duration_override integer,
    activity_id integer,
    CONSTRAINT year_plan_meetings_duration_override_check CHECK (((duration_override IS NULL) OR (duration_override > 0)))
);


--
-- Name: COLUMN year_plan_meetings.activity_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.year_plan_meetings.activity_id IS 'Optional link to an outing/event in the activities table (carpools, permission slips).';


--
-- Name: year_plan_meetings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.year_plan_meetings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: year_plan_meetings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.year_plan_meetings_id_seq OWNED BY public.year_plan_meetings.id;


--
-- Name: year_plan_objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.year_plan_objectives (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    year_plan_id integer NOT NULL,
    period_id integer,
    parent_id integer,
    title character varying(255) NOT NULL,
    description text,
    scope character varying(20) DEFAULT 'unit'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT year_plan_objectives_scope_check CHECK (((scope)::text = ANY (ARRAY[('unit'::character varying)::text, ('participant'::character varying)::text])))
);


--
-- Name: year_plan_objectives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.year_plan_objectives_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: year_plan_objectives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.year_plan_objectives_id_seq OWNED BY public.year_plan_objectives.id;


--
-- Name: year_plan_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.year_plan_periods (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    year_plan_id integer NOT NULL,
    title character varying(255) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: year_plan_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.year_plan_periods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: year_plan_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.year_plan_periods_id_seq OWNED BY public.year_plan_periods.id;


--
-- Name: year_plan_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.year_plan_reminders (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    meeting_id integer,
    channel character varying(20) DEFAULT 'email'::character varying NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    custom_message text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_recurring boolean DEFAULT false NOT NULL,
    reminder_date date,
    CONSTRAINT year_plan_reminders_channel_check CHECK (((channel)::text = ANY (ARRAY[('email'::character varying)::text, ('whatsapp'::character varying)::text, ('google'::character varying)::text]))),
    CONSTRAINT year_plan_reminders_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('sent'::character varying)::text, ('failed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: year_plan_reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.year_plan_reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: year_plan_reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.year_plan_reminders_id_seq OWNED BY public.year_plan_reminders.id;


--
-- Name: year_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.year_plans (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    title character varying(255) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    default_location text,
    recurrence_pattern character varying(20) DEFAULT 'weekly'::character varying NOT NULL,
    blackout_dates jsonb DEFAULT '[]'::jsonb NOT NULL,
    anchors jsonb DEFAULT '[]'::jsonb NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    CONSTRAINT year_plans_recurrence_pattern_check CHECK (((recurrence_pattern)::text = ANY (ARRAY[('weekly'::character varying)::text, ('biweekly'::character varying)::text])))
);


--
-- Name: year_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.year_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: year_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.year_plans_id_seq OWNED BY public.year_plans.id;


--
-- Name: activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities ALTER COLUMN id SET DEFAULT nextval('public.activities_id_seq'::regclass);


--
-- Name: activity_distribution_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_distribution_rules ALTER COLUMN id SET DEFAULT nextval('public.activity_distribution_rules_id_seq'::regclass);


--
-- Name: activity_library id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_library ALTER COLUMN id SET DEFAULT nextval('public.activity_library_id_seq'::regclass);


--
-- Name: announcement_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_logs ALTER COLUMN id SET DEFAULT nextval('public.announcement_logs_id_seq'::regclass);


--
-- Name: announcements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements ALTER COLUMN id SET DEFAULT nextval('public.announcements_id_seq'::regclass);


--
-- Name: attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance ALTER COLUMN id SET DEFAULT nextval('public.attendance_id_seq'::regclass);


--
-- Name: badge_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_progress ALTER COLUMN id SET DEFAULT nextval('public.badge_progress_id_seq'::regclass);


--
-- Name: badge_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_templates ALTER COLUMN id SET DEFAULT nextval('public.badge_templates_id_seq'::regclass);


--
-- Name: budget_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_categories ALTER COLUMN id SET DEFAULT nextval('public.budget_categories_id_seq'::regclass);


--
-- Name: budget_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_expenses ALTER COLUMN id SET DEFAULT nextval('public.budget_expenses_id_seq'::regclass);


--
-- Name: budget_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_items ALTER COLUMN id SET DEFAULT nextval('public.budget_items_id_seq'::regclass);


--
-- Name: budget_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_plans ALTER COLUMN id SET DEFAULT nextval('public.budget_plans_id_seq'::regclass);


--
-- Name: budget_revenues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_revenues ALTER COLUMN id SET DEFAULT nextval('public.budget_revenues_id_seq'::regclass);


--
-- Name: carpool_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_assignments ALTER COLUMN id SET DEFAULT nextval('public.carpool_assignments_id_seq'::regclass);


--
-- Name: carpool_offers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_offers ALTER COLUMN id SET DEFAULT nextval('public.carpool_offers_id_seq'::regclass);


--
-- Name: equipment_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_items ALTER COLUMN id SET DEFAULT nextval('public.equipment_items_id_seq'::regclass);


--
-- Name: equipment_reservations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations ALTER COLUMN id SET DEFAULT nextval('public.equipment_reservations_id_seq'::regclass);


--
-- Name: erasure_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erasure_log ALTER COLUMN id SET DEFAULT nextval('public.erasure_log_id_seq'::regclass);


--
-- Name: fee_definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_definitions ALTER COLUMN id SET DEFAULT nextval('public.fee_definitions_id_seq'::regclass);


--
-- Name: first_aid_supplies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.first_aid_supplies ALTER COLUMN id SET DEFAULT nextval('public.first_aid_supplies_id_seq'::regclass);


--
-- Name: form_format_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_format_versions ALTER COLUMN id SET DEFAULT nextval('public.form_format_versions_id_seq'::regclass);


--
-- Name: form_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_permissions ALTER COLUMN id SET DEFAULT nextval('public.form_permissions_id_seq'::regclass);


--
-- Name: form_submission_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submission_history ALTER COLUMN id SET DEFAULT nextval('public.form_submission_history_id_seq'::regclass);


--
-- Name: form_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions ALTER COLUMN id SET DEFAULT nextval('public.form_submissions_id_seq'::regclass);


--
-- Name: google_chat_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_config ALTER COLUMN id SET DEFAULT nextval('public.google_chat_config_id_seq'::regclass);


--
-- Name: google_chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_messages ALTER COLUMN id SET DEFAULT nextval('public.google_chat_messages_id_seq'::regclass);


--
-- Name: google_chat_spaces id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_spaces ALTER COLUMN id SET DEFAULT nextval('public.google_chat_spaces_id_seq'::regclass);


--
-- Name: groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups ALTER COLUMN id SET DEFAULT nextval('public.groups_id_seq'::regclass);


--
-- Name: guests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests ALTER COLUMN id SET DEFAULT nextval('public.guests_id_seq'::regclass);


--
-- Name: honors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors ALTER COLUMN id SET DEFAULT nextval('public.honors_id_seq'::regclass);


--
-- Name: languages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.languages ALTER COLUMN id SET DEFAULT nextval('public.languages_id_seq'::regclass);


--
-- Name: local_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_groups ALTER COLUMN id SET DEFAULT nextval('public.local_groups_id_seq'::regclass);


--
-- Name: medication_admin_authorizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations ALTER COLUMN id SET DEFAULT nextval('public.medication_admin_authorizations_id_seq'::regclass);


--
-- Name: medication_distributions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions ALTER COLUMN id SET DEFAULT nextval('public.medication_distributions_id_seq'::regclass);


--
-- Name: medication_requirements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_requirements ALTER COLUMN id SET DEFAULT nextval('public.medication_requirements_id_seq'::regclass);


--
-- Name: medication_treatment_authorizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorizations ALTER COLUMN id SET DEFAULT nextval('public.medication_treatment_authorizations_id_seq'::regclass);


--
-- Name: names id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.names ALTER COLUMN id SET DEFAULT nextval('public.names_id_seq'::regclass);


--
-- Name: news id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news ALTER COLUMN id SET DEFAULT nextval('public.news_id_seq'::regclass);


--
-- Name: oas_competencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_competencies ALTER COLUMN id SET DEFAULT nextval('public.oas_competencies_id_seq'::regclass);


--
-- Name: oas_skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_skills ALTER COLUMN id SET DEFAULT nextval('public.oas_skills_id_seq'::regclass);


--
-- Name: oas_stages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_stages ALTER COLUMN id SET DEFAULT nextval('public.oas_stages_id_seq'::regclass);


--
-- Name: objective_achievements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements ALTER COLUMN id SET DEFAULT nextval('public.objective_achievements_id_seq'::regclass);


--
-- Name: organization_domains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_domains ALTER COLUMN id SET DEFAULT nextval('public.organization_domains_id_seq'::regclass);


--
-- Name: organization_form_formats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_form_formats ALTER COLUMN id SET DEFAULT nextval('public.organization_form_formats_id_seq'::regclass);


--
-- Name: organization_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings ALTER COLUMN id SET DEFAULT nextval('public.organization_settings_id_seq'::regclass);


--
-- Name: organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations ALTER COLUMN id SET DEFAULT nextval('public.organizations_id_seq'::regclass);


--
-- Name: pab_plan_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plan_items ALTER COLUMN id SET DEFAULT nextval('public.pab_plan_items_id_seq'::regclass);


--
-- Name: pab_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plans ALTER COLUMN id SET DEFAULT nextval('public.pab_plans_id_seq'::regclass);


--
-- Name: pab_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_reviews ALTER COLUMN id SET DEFAULT nextval('public.pab_reviews_id_seq'::regclass);


--
-- Name: pab_themes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_themes ALTER COLUMN id SET DEFAULT nextval('public.pab_themes_id_seq'::regclass);


--
-- Name: parents_guardians id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents_guardians ALTER COLUMN id SET DEFAULT nextval('public.guardians_id_seq'::regclass);


--
-- Name: participant_credentials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_credentials ALTER COLUMN id SET DEFAULT nextval('public.participant_credentials_id_seq'::regclass);


--
-- Name: participant_fees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_fees ALTER COLUMN id SET DEFAULT nextval('public.participant_fees_id_seq'::regclass);


--
-- Name: participant_medications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_medications ALTER COLUMN id SET DEFAULT nextval('public.participant_medications_id_seq'::regclass);


--
-- Name: participant_oas_competency id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_competency ALTER COLUMN id SET DEFAULT nextval('public.participant_oas_competency_id_seq'::regclass);


--
-- Name: participant_oas_stage_award id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_stage_award ALTER COLUMN id SET DEFAULT nextval('public.participant_oas_stage_award_id_seq'::regclass);


--
-- Name: participant_top_award_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_top_award_progress ALTER COLUMN id SET DEFAULT nextval('public.participant_top_award_progress_id_seq'::regclass);


--
-- Name: participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants ALTER COLUMN id SET DEFAULT nextval('public.new_participants_id_seq'::regclass);


--
-- Name: payment_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plans ALTER COLUMN id SET DEFAULT nextval('public.payment_plans_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: permission_slips id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips ALTER COLUMN id SET DEFAULT nextval('public.permission_slips_id_seq'::regclass);


--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);


--
-- Name: points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points ALTER COLUMN id SET DEFAULT nextval('public.points_id_seq'::regclass);


--
-- Name: processed_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_transactions ALTER COLUMN id SET DEFAULT nextval('public.processed_transactions_id_seq'::regclass);


--
-- Name: program_catalog_competencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_competencies ALTER COLUMN id SET DEFAULT nextval('public.program_catalog_competencies_id_seq'::regclass);


--
-- Name: program_catalog_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_rules ALTER COLUMN id SET DEFAULT nextval('public.program_catalog_rules_id_seq'::regclass);


--
-- Name: program_catalog_skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_skills ALTER COLUMN id SET DEFAULT nextval('public.program_catalog_skills_id_seq'::regclass);


--
-- Name: program_catalog_stages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_stages ALTER COLUMN id SET DEFAULT nextval('public.program_catalog_stages_id_seq'::regclass);


--
-- Name: program_catalog_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_versions ALTER COLUMN id SET DEFAULT nextval('public.program_catalog_versions_id_seq'::regclass);


--
-- Name: progress_approvals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_approvals ALTER COLUMN id SET DEFAULT nextval('public.progress_approvals_id_seq'::regclass);


--
-- Name: progress_evidence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_evidence ALTER COLUMN id SET DEFAULT nextval('public.progress_evidence_id_seq'::regclass);


--
-- Name: rappel_reunion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rappel_reunion ALTER COLUMN id SET DEFAULT nextval('public.rappel_reunion_id_seq'::regclass);


--
-- Name: reunion_preparations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunion_preparations ALTER COLUMN id SET DEFAULT nextval('public.reunion_preparations_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: scout_year_transitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_year_transitions ALTER COLUMN id SET DEFAULT nextval('public.scout_year_transitions_id_seq'::regclass);


--
-- Name: scout_years id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_years ALTER COLUMN id SET DEFAULT nextval('public.scout_years_id_seq'::regclass);


--
-- Name: subscribers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers ALTER COLUMN id SET DEFAULT nextval('public.subscribers_id_seq'::regclass);


--
-- Name: sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log ALTER COLUMN id SET DEFAULT nextval('public.sync_log_id_seq'::regclass);


--
-- Name: top_award_projects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_projects ALTER COLUMN id SET DEFAULT nextval('public.top_award_projects_id_seq'::regclass);


--
-- Name: top_award_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_reviews ALTER COLUMN id SET DEFAULT nextval('public.top_award_reviews_id_seq'::regclass);


--
-- Name: top_award_service_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_service_logs ALTER COLUMN id SET DEFAULT nextval('public.top_award_service_logs_id_seq'::regclass);


--
-- Name: top_awards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_awards ALTER COLUMN id SET DEFAULT nextval('public.top_awards_id_seq'::regclass);


--
-- Name: translations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.translations ALTER COLUMN id SET DEFAULT nextval('public.translations_id_seq'::regclass);


--
-- Name: user_organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations ALTER COLUMN id SET DEFAULT nextval('public.user_organizations_id_seq'::regclass);


--
-- Name: whatsapp_baileys_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_baileys_connections ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_baileys_connections_id_seq'::regclass);


--
-- Name: year_plan_meeting_activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meeting_activities ALTER COLUMN id SET DEFAULT nextval('public.year_plan_meeting_activities_id_seq'::regclass);


--
-- Name: year_plan_meetings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings ALTER COLUMN id SET DEFAULT nextval('public.year_plan_meetings_id_seq'::regclass);


--
-- Name: year_plan_objectives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_objectives ALTER COLUMN id SET DEFAULT nextval('public.year_plan_objectives_id_seq'::regclass);


--
-- Name: year_plan_periods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_periods ALTER COLUMN id SET DEFAULT nextval('public.year_plan_periods_id_seq'::regclass);


--
-- Name: year_plan_reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_reminders ALTER COLUMN id SET DEFAULT nextval('public.year_plan_reminders_id_seq'::regclass);


--
-- Name: year_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plans ALTER COLUMN id SET DEFAULT nextval('public.year_plans_id_seq'::regclass);


--
-- Name: activites_rencontre activites_rencontre_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activites_rencontre
    ADD CONSTRAINT activites_rencontre_pkey PRIMARY KEY (id);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activity_distribution_rules activity_distribution_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_distribution_rules
    ADD CONSTRAINT activity_distribution_rules_pkey PRIMARY KEY (id);


--
-- Name: activity_library activity_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_library
    ADD CONSTRAINT activity_library_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_log ai_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_monthly ai_usage_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_monthly
    ADD CONSTRAINT ai_usage_monthly_pkey PRIMARY KEY (month_key);


--
-- Name: announcement_logs announcement_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_logs
    ADD CONSTRAINT announcement_logs_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: badge_progress badge_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_progress
    ADD CONSTRAINT badge_progress_pkey PRIMARY KEY (id);


--
-- Name: badge_templates badge_templates_org_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_templates
    ADD CONSTRAINT badge_templates_org_key UNIQUE (organization_id, template_key);


--
-- Name: badge_templates badge_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_templates
    ADD CONSTRAINT badge_templates_pkey PRIMARY KEY (id);


--
-- Name: budget_categories budget_categories_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_categories
    ADD CONSTRAINT budget_categories_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: budget_categories budget_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_categories
    ADD CONSTRAINT budget_categories_pkey PRIMARY KEY (id);


--
-- Name: budget_expenses budget_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_expenses
    ADD CONSTRAINT budget_expenses_pkey PRIMARY KEY (id);


--
-- Name: budget_items budget_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_items
    ADD CONSTRAINT budget_items_pkey PRIMARY KEY (id);


--
-- Name: budget_plans budget_plans_organization_id_budget_item_id_fiscal_year_sta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_plans
    ADD CONSTRAINT budget_plans_organization_id_budget_item_id_fiscal_year_sta_key UNIQUE (organization_id, budget_item_id, fiscal_year_start);


--
-- Name: budget_plans budget_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_plans
    ADD CONSTRAINT budget_plans_pkey PRIMARY KEY (id);


--
-- Name: budget_revenues budget_revenues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_revenues
    ADD CONSTRAINT budget_revenues_pkey PRIMARY KEY (id);


--
-- Name: fundraiser_entries calendars_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundraiser_entries
    ADD CONSTRAINT calendars_id_key UNIQUE (id);


--
-- Name: carpool_assignments carpool_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_assignments
    ADD CONSTRAINT carpool_assignments_pkey PRIMARY KEY (id);


--
-- Name: carpool_offers carpool_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_offers
    ADD CONSTRAINT carpool_offers_pkey PRIMARY KEY (id);


--
-- Name: equipment_item_organizations equipment_item_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_item_organizations
    ADD CONSTRAINT equipment_item_organizations_pkey PRIMARY KEY (equipment_id, organization_id);


--
-- Name: equipment_items equipment_items_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_items
    ADD CONSTRAINT equipment_items_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: equipment_items equipment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_items
    ADD CONSTRAINT equipment_items_pkey PRIMARY KEY (id);


--
-- Name: equipment_reservations equipment_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_pkey PRIMARY KEY (id);


--
-- Name: equipment_reservations equipment_reservations_unique_reservation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_unique_reservation UNIQUE (organization_id, equipment_id, meeting_date, reserved_for);


--
-- Name: erasure_log erasure_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erasure_log
    ADD CONSTRAINT erasure_log_pkey PRIMARY KEY (id);


--
-- Name: fee_definitions fee_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_definitions
    ADD CONSTRAINT fee_definitions_pkey PRIMARY KEY (id);


--
-- Name: first_aid_supplies first_aid_supplies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.first_aid_supplies
    ADD CONSTRAINT first_aid_supplies_pkey PRIMARY KEY (id);


--
-- Name: form_format_versions form_format_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_format_versions
    ADD CONSTRAINT form_format_versions_pkey PRIMARY KEY (id);


--
-- Name: form_permissions form_permissions_form_format_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_permissions
    ADD CONSTRAINT form_permissions_form_format_id_role_id_key UNIQUE (form_format_id, role_id);


--
-- Name: form_permissions form_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_permissions
    ADD CONSTRAINT form_permissions_pkey PRIMARY KEY (id);


--
-- Name: form_submission_history form_submission_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submission_history
    ADD CONSTRAINT form_submission_history_pkey PRIMARY KEY (id);


--
-- Name: form_submissions form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (id);


--
-- Name: form_submissions form_submissions_unique_constraint; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_unique_constraint UNIQUE (participant_id, form_type, organization_id);


--
-- Name: fundraiser_entries fundraiser_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundraiser_entries
    ADD CONSTRAINT fundraiser_entries_pkey PRIMARY KEY (id);


--
-- Name: fundraisers fundraisers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundraisers
    ADD CONSTRAINT fundraisers_pkey PRIMARY KEY (id);


--
-- Name: google_chat_config google_chat_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_config
    ADD CONSTRAINT google_chat_config_pkey PRIMARY KEY (id);


--
-- Name: google_chat_messages google_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_messages
    ADD CONSTRAINT google_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: google_chat_spaces google_chat_spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_spaces
    ADD CONSTRAINT google_chat_spaces_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: guardian_users guardian_users_gu_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_users
    ADD CONSTRAINT guardian_users_gu_id_key UNIQUE (gu_id);


--
-- Name: guardian_users guardian_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_users
    ADD CONSTRAINT guardian_users_pkey PRIMARY KEY (gu_id);


--
-- Name: parents_guardians guardians_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents_guardians
    ADD CONSTRAINT guardians_pkey PRIMARY KEY (id);


--
-- Name: guests guests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_pkey PRIMARY KEY (id);


--
-- Name: honors honors_name_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors
    ADD CONSTRAINT honors_name_id_date_unique UNIQUE (participant_id, date);


--
-- Name: honors honors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors
    ADD CONSTRAINT honors_pkey PRIMARY KEY (id);


--
-- Name: incident_email_queue incident_email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_email_queue
    ADD CONSTRAINT incident_email_queue_pkey PRIMARY KEY (id);


--
-- Name: incident_escalation_contacts incident_escalation_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_escalation_contacts
    ADD CONSTRAINT incident_escalation_contacts_pkey PRIMARY KEY (id);


--
-- Name: incident_reports incident_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_pkey PRIMARY KEY (id);


--
-- Name: languages languages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.languages
    ADD CONSTRAINT languages_pkey PRIMARY KEY (id);


--
-- Name: local_groups local_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_groups
    ADD CONSTRAINT local_groups_pkey PRIMARY KEY (id);


--
-- Name: local_groups local_groups_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_groups
    ADD CONSTRAINT local_groups_slug_key UNIQUE (slug);


--
-- Name: medication_admin_authorization_requirements maar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorization_requirements
    ADD CONSTRAINT maar_pkey PRIMARY KEY (authorization_id, medication_requirement_id);


--
-- Name: medication_admin_authorizations medication_admin_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT medication_admin_authorizations_pkey PRIMARY KEY (id);


--
-- Name: medication_distributions medication_distributions_organization_id_medication_require_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions
    ADD CONSTRAINT medication_distributions_organization_id_medication_require_key UNIQUE (organization_id, medication_requirement_id, participant_id, scheduled_for);


--
-- Name: medication_distributions medication_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions
    ADD CONSTRAINT medication_distributions_pkey PRIMARY KEY (id);


--
-- Name: medication_receptions medication_receptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_receptions
    ADD CONSTRAINT medication_receptions_pkey PRIMARY KEY (id);


--
-- Name: medication_requirements medication_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_requirements
    ADD CONSTRAINT medication_requirements_pkey PRIMARY KEY (id);


--
-- Name: medication_treatment_authorizations medication_treatment_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorizations
    ADD CONSTRAINT medication_treatment_authorizations_pkey PRIMARY KEY (id);


--
-- Name: medication_treatment_authorization_supplies mtas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorization_supplies
    ADD CONSTRAINT mtas_pkey PRIMARY KEY (authorization_id, first_aid_supply_id);


--
-- Name: names names_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.names
    ADD CONSTRAINT names_pkey PRIMARY KEY (id);


--
-- Name: participants new_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT new_participants_pkey PRIMARY KEY (id);


--
-- Name: news news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news
    ADD CONSTRAINT news_pkey PRIMARY KEY (id);


--
-- Name: oas_competencies oas_competencies_organization_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_competencies
    ADD CONSTRAINT oas_competencies_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: oas_competencies oas_competencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_competencies
    ADD CONSTRAINT oas_competencies_pkey PRIMARY KEY (id);


--
-- Name: oas_skills oas_skills_organization_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_skills
    ADD CONSTRAINT oas_skills_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: oas_skills oas_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_skills
    ADD CONSTRAINT oas_skills_pkey PRIMARY KEY (id);


--
-- Name: oas_stages oas_stages_organization_id_oas_skill_id_stage_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_stages
    ADD CONSTRAINT oas_stages_organization_id_oas_skill_id_stage_order_key UNIQUE (organization_id, oas_skill_id, stage_order);


--
-- Name: oas_stages oas_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_stages
    ADD CONSTRAINT oas_stages_pkey PRIMARY KEY (id);


--
-- Name: objective_achievements objective_achievements_organization_id_objective_id_partici_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements
    ADD CONSTRAINT objective_achievements_organization_id_objective_id_partici_key UNIQUE (organization_id, objective_id, participant_id);


--
-- Name: objective_achievements objective_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements
    ADD CONSTRAINT objective_achievements_pkey PRIMARY KEY (id);


--
-- Name: organization_domains organization_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_domains
    ADD CONSTRAINT organization_domains_pkey PRIMARY KEY (id);


--
-- Name: organization_form_formats organization_form_formats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_form_formats
    ADD CONSTRAINT organization_form_formats_pkey PRIMARY KEY (id);


--
-- Name: organization_local_groups organization_local_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_local_groups
    ADD CONSTRAINT organization_local_groups_pkey PRIMARY KEY (organization_id, local_group_id);


--
-- Name: organization_program_sections organization_program_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_program_sections
    ADD CONSTRAINT organization_program_sections_pkey PRIMARY KEY (organization_id, section_key);


--
-- Name: organization_settings organization_settings_organization_id_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_organization_id_setting_key_key UNIQUE (organization_id, setting_key);


--
-- Name: organization_settings organization_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_API_KEY_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT "organizations_API_KEY_key" UNIQUE (api_key);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: pab_plan_items pab_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plan_items
    ADD CONSTRAINT pab_plan_items_pkey PRIMARY KEY (id);


--
-- Name: pab_plans pab_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plans
    ADD CONSTRAINT pab_plans_pkey PRIMARY KEY (id);


--
-- Name: pab_reviews pab_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_reviews
    ADD CONSTRAINT pab_reviews_pkey PRIMARY KEY (id);


--
-- Name: pab_themes pab_themes_organization_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_themes
    ADD CONSTRAINT pab_themes_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: pab_themes pab_themes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_themes
    ADD CONSTRAINT pab_themes_pkey PRIMARY KEY (id);


--
-- Name: participant_credentials participant_credentials_organization_id_participant_id_cred_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_credentials
    ADD CONSTRAINT participant_credentials_organization_id_participant_id_cred_key UNIQUE (organization_id, participant_id, credential_key);


--
-- Name: participant_credentials participant_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_credentials
    ADD CONSTRAINT participant_credentials_pkey PRIMARY KEY (id);


--
-- Name: participant_enrollments participant_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_enrollments
    ADD CONSTRAINT participant_enrollments_pkey PRIMARY KEY (participant_id, organization_id, scout_year_id);


--
-- Name: participant_fees participant_fees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_fees
    ADD CONSTRAINT participant_fees_pkey PRIMARY KEY (id);


--
-- Name: participant_group_assignments participant_group_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_group_assignments
    ADD CONSTRAINT participant_group_assignments_pkey PRIMARY KEY (participant_id, organization_id, scout_year_id);


--
-- Name: participant_guardians participant_guardians_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_guardians
    ADD CONSTRAINT participant_guardians_pkey1 PRIMARY KEY (guardian_id, participant_id);


--
-- Name: participant_medications participant_medications_organization_id_medication_requirem_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_medications
    ADD CONSTRAINT participant_medications_organization_id_medication_requirem_key UNIQUE (organization_id, medication_requirement_id, participant_id);


--
-- Name: participant_medications participant_medications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_medications
    ADD CONSTRAINT participant_medications_pkey PRIMARY KEY (id);


--
-- Name: participant_oas_competency participant_oas_competency_organization_id_participant_id_o_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_competency
    ADD CONSTRAINT participant_oas_competency_organization_id_participant_id_o_key UNIQUE (organization_id, participant_id, oas_competency_id);


--
-- Name: participant_oas_competency participant_oas_competency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_competency
    ADD CONSTRAINT participant_oas_competency_pkey PRIMARY KEY (id);


--
-- Name: participant_oas_stage_award participant_oas_stage_award_organization_id_participant_id__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_stage_award
    ADD CONSTRAINT participant_oas_stage_award_organization_id_participant_id__key UNIQUE (organization_id, participant_id, oas_stage_id);


--
-- Name: participant_oas_stage_award participant_oas_stage_award_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_stage_award
    ADD CONSTRAINT participant_oas_stage_award_pkey PRIMARY KEY (id);


--
-- Name: participant_top_award_progress participant_top_award_progres_organization_id_participant_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_top_award_progress
    ADD CONSTRAINT participant_top_award_progres_organization_id_participant_i_key UNIQUE (organization_id, participant_id, top_award_id);


--
-- Name: participant_top_award_progress participant_top_award_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_top_award_progress
    ADD CONSTRAINT participant_top_award_progress_pkey PRIMARY KEY (id);


--
-- Name: payment_plans payment_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permission_slips permission_slips_access_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_access_token_key UNIQUE (access_token);


--
-- Name: permission_slips permission_slips_organization_id_participant_id_meeting_dat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_organization_id_participant_id_meeting_dat_key UNIQUE (organization_id, participant_id, meeting_date);


--
-- Name: permission_slips permission_slips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_permission_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_permission_key_key UNIQUE (permission_key);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: points points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_pkey PRIMARY KEY (id);


--
-- Name: processed_transactions processed_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_transactions
    ADD CONSTRAINT processed_transactions_pkey PRIMARY KEY (id);


--
-- Name: profile profile_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile
    ADD CONSTRAINT profile_email_key UNIQUE (email);


--
-- Name: profile profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile
    ADD CONSTRAINT profile_pkey PRIMARY KEY (id, email);


--
-- Name: profile profile_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile
    ADD CONSTRAINT profile_uuid_key UNIQUE (id);


--
-- Name: program_catalog_competencies program_catalog_competencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_competencies
    ADD CONSTRAINT program_catalog_competencies_pkey PRIMARY KEY (id);


--
-- Name: program_catalog_rules program_catalog_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_rules
    ADD CONSTRAINT program_catalog_rules_pkey PRIMARY KEY (id);


--
-- Name: program_catalog_skills program_catalog_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_skills
    ADD CONSTRAINT program_catalog_skills_pkey PRIMARY KEY (id);


--
-- Name: program_catalog_stages program_catalog_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_stages
    ADD CONSTRAINT program_catalog_stages_pkey PRIMARY KEY (id);


--
-- Name: program_catalog_versions program_catalog_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_versions
    ADD CONSTRAINT program_catalog_versions_pkey PRIMARY KEY (id);


--
-- Name: progress_approvals progress_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_approvals
    ADD CONSTRAINT progress_approvals_pkey PRIMARY KEY (id);


--
-- Name: progress_evidence progress_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_evidence
    ADD CONSTRAINT progress_evidence_pkey PRIMARY KEY (id);


--
-- Name: rappel_reunion rappel_reunion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rappel_reunion
    ADD CONSTRAINT rappel_reunion_pkey PRIMARY KEY (id);


--
-- Name: reunion_preparations reunion_preparations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunion_preparations
    ADD CONSTRAINT reunion_preparations_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);


--
-- Name: scout_year_transitions scout_year_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_year_transitions
    ADD CONSTRAINT scout_year_transitions_pkey PRIMARY KEY (id);


--
-- Name: scout_years scout_years_label_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_years
    ADD CONSTRAINT scout_years_label_unique UNIQUE (organization_id, label);


--
-- Name: scout_years scout_years_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_years
    ADD CONSTRAINT scout_years_no_overlap EXCLUDE USING gist (organization_id WITH =, daterange(start_date, end_date, '[]'::text) WITH &&);


--
-- Name: scout_years scout_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_years
    ADD CONSTRAINT scout_years_pkey PRIMARY KEY (id);


--
-- Name: subscribers subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_pkey PRIMARY KEY (id);


--
-- Name: sync_log sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_pkey PRIMARY KEY (id);


--
-- Name: top_award_projects top_award_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_projects
    ADD CONSTRAINT top_award_projects_pkey PRIMARY KEY (id);


--
-- Name: top_award_reviews top_award_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_reviews
    ADD CONSTRAINT top_award_reviews_pkey PRIMARY KEY (id);


--
-- Name: top_award_service_logs top_award_service_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_service_logs
    ADD CONSTRAINT top_award_service_logs_pkey PRIMARY KEY (id);


--
-- Name: top_awards top_awards_organization_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_awards
    ADD CONSTRAINT top_awards_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: top_awards top_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_awards
    ADD CONSTRAINT top_awards_pkey PRIMARY KEY (id);


--
-- Name: translations translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.translations
    ADD CONSTRAINT translations_pkey PRIMARY KEY (id);


--
-- Name: trusted_devices trusted_devices_device_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_device_token_key UNIQUE (device_token);


--
-- Name: trusted_devices trusted_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_pkey PRIMARY KEY (id);


--
-- Name: two_factor_codes two_factor_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factor_codes
    ADD CONSTRAINT two_factor_codes_pkey PRIMARY KEY (id);


--
-- Name: google_chat_config unique_active_google_chat_config; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_config
    ADD CONSTRAINT unique_active_google_chat_config EXCLUDE USING btree (organization_id WITH =) WHERE ((is_active = true));


--
-- Name: attendance unique_attendance_participant_date_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT unique_attendance_participant_date_org UNIQUE (participant_id, date, organization_id);


--
-- Name: subscribers unique_endpoint; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT unique_endpoint UNIQUE (endpoint);


--
-- Name: form_permissions unique_form_role_permission; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_permissions
    ADD CONSTRAINT unique_form_role_permission UNIQUE (form_format_id, role_id);


--
-- Name: form_format_versions unique_form_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_format_versions
    ADD CONSTRAINT unique_form_version UNIQUE (form_format_id, version_number);


--
-- Name: google_chat_spaces unique_google_chat_space; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_spaces
    ADD CONSTRAINT unique_google_chat_space UNIQUE (space_id);


--
-- Name: honors unique_honor_per_date_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors
    ADD CONSTRAINT unique_honor_per_date_per_org UNIQUE (participant_id, date, organization_id);


--
-- Name: whatsapp_baileys_connections unique_org_whatsapp_connection; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_baileys_connections
    ADD CONSTRAINT unique_org_whatsapp_connection UNIQUE (organization_id);


--
-- Name: participant_fees unique_participant_fee_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_fees
    ADD CONSTRAINT unique_participant_fee_period UNIQUE (participant_id, fee_definition_id, organization_id);


--
-- Name: carpool_assignments unique_participant_offer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_assignments
    ADD CONSTRAINT unique_participant_offer UNIQUE (carpool_offer_id, participant_id, trip_direction);


--
-- Name: reunion_preparations unique_reunion_preparation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunion_preparations
    ADD CONSTRAINT unique_reunion_preparation UNIQUE (date, organization_id);


--
-- Name: program_catalog_competencies uq_program_catalog_competencies; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_competencies
    ADD CONSTRAINT uq_program_catalog_competencies UNIQUE (program, version, code);


--
-- Name: program_catalog_rules uq_program_catalog_rules; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_rules
    ADD CONSTRAINT uq_program_catalog_rules UNIQUE (program, version);


--
-- Name: program_catalog_skills uq_program_catalog_skills; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_skills
    ADD CONSTRAINT uq_program_catalog_skills UNIQUE (program, version, official_key);


--
-- Name: program_catalog_stages uq_program_catalog_stages; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_stages
    ADD CONSTRAINT uq_program_catalog_stages UNIQUE (program, version, stage_no);


--
-- Name: program_catalog_versions uq_program_catalog_versions_program_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_versions
    ADD CONSTRAINT uq_program_catalog_versions_program_version UNIQUE (program, version);


--
-- Name: user_organizations user_organization_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organization_unique UNIQUE (user_id, organization_id);


--
-- Name: user_organizations user_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_pkey PRIMARY KEY (id);


--
-- Name: user_participants user_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_participants
    ADD CONSTRAINT user_participants_pkey PRIMARY KEY (participant_id, user_id);


--
-- Name: profiles users_duplicate_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT users_duplicate_email_key UNIQUE (email);


--
-- Name: profiles users_duplicate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT users_duplicate_pkey PRIMARY KEY (id, email);


--
-- Name: profiles users_duplicate_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT users_duplicate_uuid_key UNIQUE (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id, email);


--
-- Name: users users_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_uuid_unique UNIQUE (id);


--
-- Name: users users_verification_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_verification_token_key UNIQUE (verification_token);


--
-- Name: whatsapp_baileys_connections whatsapp_baileys_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_baileys_connections
    ADD CONSTRAINT whatsapp_baileys_connections_pkey PRIMARY KEY (id);


--
-- Name: year_plan_meeting_activities year_plan_meeting_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meeting_activities
    ADD CONSTRAINT year_plan_meeting_activities_pkey PRIMARY KEY (id);


--
-- Name: year_plan_meetings year_plan_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings
    ADD CONSTRAINT year_plan_meetings_pkey PRIMARY KEY (id);


--
-- Name: year_plan_objectives year_plan_objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_objectives
    ADD CONSTRAINT year_plan_objectives_pkey PRIMARY KEY (id);


--
-- Name: year_plan_periods year_plan_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_periods
    ADD CONSTRAINT year_plan_periods_pkey PRIMARY KEY (id);


--
-- Name: year_plan_reminders year_plan_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_reminders
    ADD CONSTRAINT year_plan_reminders_pkey PRIMARY KEY (id);


--
-- Name: year_plans year_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plans
    ADD CONSTRAINT year_plans_pkey PRIMARY KEY (id);


--
-- Name: erasure_log_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erasure_log_org_idx ON public.erasure_log USING btree (organization_id, performed_at DESC);


--
-- Name: form_submissions_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_submissions_review_idx ON public.form_submissions USING btree (organization_id, review_state) WHERE (review_state = 'needs_review'::text);


--
-- Name: form_submissions_scout_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_submissions_scout_year_idx ON public.form_submissions USING btree (organization_id, scout_year_id, participant_id);


--
-- Name: idx_activities_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_active ON public.activities USING btree (is_active);


--
-- Name: idx_activities_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_date ON public.activities USING btree (activity_date);


--
-- Name: idx_activities_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_organization ON public.activities USING btree (organization_id);


--
-- Name: idx_activity_library_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_library_category ON public.activity_library USING btree (organization_id, category);


--
-- Name: idx_activity_library_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_library_org ON public.activity_library USING btree (organization_id);


--
-- Name: idx_ai_usage_log_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_log_month ON public.ai_usage_log USING btree (month_key);


--
-- Name: idx_ai_usage_log_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_log_org ON public.ai_usage_log USING btree (organization_id);


--
-- Name: idx_ai_usage_log_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_log_user ON public.ai_usage_log USING btree (user_id);


--
-- Name: idx_announcements_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_org_status ON public.announcements USING btree (organization_id, status);


--
-- Name: idx_announcements_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_scheduled ON public.announcements USING btree (scheduled_at);


--
-- Name: idx_attendance_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_created_at ON public.attendance USING btree (created_at);


--
-- Name: idx_attendance_name_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_name_date ON public.attendance USING btree (participant_id, date);


--
-- Name: idx_attendance_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_organization_id ON public.attendance USING btree (organization_id);


--
-- Name: idx_attendance_participant_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_participant_org_date ON public.attendance USING btree (participant_id, organization_id, date DESC);


--
-- Name: idx_badge_progress_org_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_org_delivery ON public.badge_progress USING btree (organization_id, status, delivered_at) WHERE ((status)::text = 'approved'::text);


--
-- Name: idx_badge_progress_participant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_participant_date ON public.badge_progress USING btree (participant_id, date_obtention DESC);


--
-- Name: idx_badge_progress_participant_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_participant_org_status ON public.badge_progress USING btree (participant_id, organization_id, status);


--
-- Name: idx_badge_progress_participant_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_participant_template ON public.badge_progress USING btree (participant_id, badge_template_id, organization_id);


--
-- Name: idx_badge_progress_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_section ON public.badge_progress USING btree (section);


--
-- Name: idx_badge_progress_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_source ON public.badge_progress USING btree (organization_id, source_type, source_id);


--
-- Name: idx_badge_progress_status_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_status_approval ON public.badge_progress USING btree (status, approval_date) WHERE (((status)::text = 'pending'::text) OR (((status)::text = 'approved'::text) AND (delivered_at IS NULL)));


--
-- Name: idx_badge_progress_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_progress_template ON public.badge_progress USING btree (badge_template_id, participant_id);


--
-- Name: idx_badge_templates_official_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_templates_official_key ON public.badge_templates USING btree (official_key);


--
-- Name: idx_badge_templates_org_official_key_version_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_badge_templates_org_official_key_version_unique ON public.badge_templates USING btree (organization_id, official_key, version) WHERE (official_key IS NOT NULL);


--
-- Name: idx_badge_templates_org_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_templates_org_section ON public.badge_templates USING btree (organization_id, section);


--
-- Name: idx_badge_templates_program_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_templates_program_type ON public.badge_templates USING btree (program_type);


--
-- Name: idx_budget_categories_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_categories_org ON public.budget_categories USING btree (organization_id);


--
-- Name: idx_budget_expenses_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_expenses_category ON public.budget_expenses USING btree (budget_category_id);


--
-- Name: idx_budget_expenses_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_expenses_item ON public.budget_expenses USING btree (budget_item_id);


--
-- Name: idx_budget_expenses_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_expenses_org_date ON public.budget_expenses USING btree (organization_id, expense_date);


--
-- Name: idx_budget_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_items_category ON public.budget_items USING btree (budget_category_id);


--
-- Name: idx_budget_items_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_items_org ON public.budget_items USING btree (organization_id);


--
-- Name: idx_budget_plans_org_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_plans_org_year ON public.budget_plans USING btree (organization_id, fiscal_year_start);


--
-- Name: idx_budget_revenues_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_revenues_category ON public.budget_revenues USING btree (budget_category_id);


--
-- Name: idx_budget_revenues_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_revenues_item ON public.budget_revenues USING btree (budget_item_id);


--
-- Name: idx_budget_revenues_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_revenues_org_date ON public.budget_revenues USING btree (organization_id, revenue_date);


--
-- Name: idx_carpool_assignments_assigned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_assignments_assigned_by ON public.carpool_assignments USING btree (assigned_by);


--
-- Name: idx_carpool_assignments_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_assignments_offer ON public.carpool_assignments USING btree (carpool_offer_id);


--
-- Name: idx_carpool_assignments_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_assignments_organization ON public.carpool_assignments USING btree (organization_id);


--
-- Name: idx_carpool_assignments_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_assignments_participant ON public.carpool_assignments USING btree (participant_id);


--
-- Name: idx_carpool_offers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_offers_active ON public.carpool_offers USING btree (is_active);


--
-- Name: idx_carpool_offers_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_offers_activity ON public.carpool_offers USING btree (activity_id);


--
-- Name: idx_carpool_offers_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_offers_organization ON public.carpool_offers USING btree (organization_id);


--
-- Name: idx_carpool_offers_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carpool_offers_user ON public.carpool_offers USING btree (user_id);


--
-- Name: idx_dist_rules_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dist_rules_plan ON public.activity_distribution_rules USING btree (year_plan_id);


--
-- Name: idx_equipment_item_org_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_item_org_org ON public.equipment_item_organizations USING btree (organization_id);


--
-- Name: idx_equipment_items_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_items_org ON public.equipment_items USING btree (organization_id);


--
-- Name: idx_equipment_reservations_activity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_reservations_activity_id ON public.equipment_reservations USING btree (activity_id);


--
-- Name: idx_equipment_reservations_activity_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_reservations_activity_org ON public.equipment_reservations USING btree (activity_id, organization_id) WHERE (activity_id IS NOT NULL);


--
-- Name: idx_equipment_reservations_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_reservations_org_date ON public.equipment_reservations USING btree (organization_id, meeting_date);


--
-- Name: idx_equipment_reservations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_reservations_status ON public.equipment_reservations USING btree (status);


--
-- Name: idx_fee_definitions_budget_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_definitions_budget_category ON public.fee_definitions USING btree (budget_category_id);


--
-- Name: idx_form_formats_display_context; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_formats_display_context ON public.organization_form_formats USING gin (display_context);


--
-- Name: idx_form_permissions_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_permissions_form ON public.form_permissions USING btree (form_format_id);


--
-- Name: idx_form_permissions_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_permissions_role ON public.form_permissions USING btree (role_id);


--
-- Name: idx_form_submissions_org_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_org_type ON public.form_submissions USING btree (organization_id, form_type);


--
-- Name: idx_form_submissions_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_participant ON public.form_submissions USING btree (participant_id, form_type);


--
-- Name: idx_form_submissions_participant_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_participant_org ON public.form_submissions USING btree (participant_id, organization_id);


--
-- Name: idx_form_submissions_participant_org_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_participant_org_type ON public.form_submissions USING btree (participant_id, organization_id, form_type);


--
-- Name: idx_form_submissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_status ON public.form_submissions USING btree (status);


--
-- Name: idx_form_submissions_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_version ON public.form_submissions USING btree (form_version_id);


--
-- Name: idx_form_versions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_versions_active ON public.form_format_versions USING btree (form_format_id, is_active);


--
-- Name: idx_form_versions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_versions_created_at ON public.form_format_versions USING btree (created_at DESC);


--
-- Name: idx_form_versions_format_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_versions_format_id ON public.form_format_versions USING btree (form_format_id);


--
-- Name: idx_fundraisers_budget_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fundraisers_budget_category ON public.fundraisers USING btree (budget_category_id);


--
-- Name: idx_google_chat_config_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_google_chat_config_active ON public.google_chat_config USING btree (organization_id, is_active) WHERE (is_active = true);


--
-- Name: idx_google_chat_config_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_google_chat_config_org_id ON public.google_chat_config USING btree (organization_id);


--
-- Name: idx_google_chat_messages_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_google_chat_messages_org_id ON public.google_chat_messages USING btree (organization_id, sent_at DESC);


--
-- Name: idx_google_chat_messages_space_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_google_chat_messages_space_id ON public.google_chat_messages USING btree (space_id, sent_at DESC);


--
-- Name: idx_google_chat_spaces_broadcast; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_google_chat_spaces_broadcast ON public.google_chat_spaces USING btree (organization_id, is_broadcast_space) WHERE ((is_broadcast_space = true) AND (is_active = true));


--
-- Name: idx_google_chat_spaces_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_google_chat_spaces_org_id ON public.google_chat_spaces USING btree (organization_id);


--
-- Name: idx_groups; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups ON public.groups USING btree (id, organization_id);


--
-- Name: idx_groups_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_organization ON public.groups USING btree (organization_id);


--
-- Name: idx_groups_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_section ON public.groups USING btree (organization_id, section);


--
-- Name: idx_guardians_courriel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_guardians_courriel ON public.parents_guardians USING btree (courriel);


--
-- Name: idx_guests_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_org_date ON public.guests USING btree (organization_id, attendance_date);


--
-- Name: idx_honors_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honors_created_at ON public.honors USING btree (created_at);


--
-- Name: idx_honors_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honors_created_by ON public.honors USING btree (created_by);


--
-- Name: idx_honors_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honors_org_date ON public.honors USING btree (organization_id, date DESC);


--
-- Name: idx_honors_participant_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honors_participant_org ON public.honors USING btree (participant_id, organization_id);


--
-- Name: idx_incident_email_queue_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_email_queue_org ON public.incident_email_queue USING btree (organization_id);


--
-- Name: idx_incident_email_queue_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_email_queue_pending ON public.incident_email_queue USING btree (status) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('sending'::character varying)::text]));


--
-- Name: idx_incident_escalation_contacts_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_escalation_contacts_org ON public.incident_escalation_contacts USING btree (organization_id);


--
-- Name: idx_incident_reports_activity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_activity_id ON public.incident_reports USING btree (activity_id);


--
-- Name: idx_incident_reports_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_created_by ON public.incident_reports USING btree (created_by);


--
-- Name: idx_incident_reports_incident_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_incident_date ON public.incident_reports USING btree (incident_date DESC);


--
-- Name: idx_incident_reports_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_organization_id ON public.incident_reports USING btree (organization_id);


--
-- Name: idx_incident_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_status ON public.incident_reports USING btree (status);


--
-- Name: idx_incident_reports_victim_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_victim_participant ON public.incident_reports USING btree (victim_participant_id);


--
-- Name: idx_medication_distributions_reminder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_distributions_reminder ON public.medication_distributions USING btree (organization_id, scheduled_for, status, reminder_sent_at) WHERE (((status)::text = 'scheduled'::text) AND (reminder_sent_at IS NULL));


--
-- Name: idx_medication_distributions_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_distributions_schedule ON public.medication_distributions USING btree (organization_id, scheduled_for);


--
-- Name: idx_medication_receptions_activity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_receptions_activity_id ON public.medication_receptions USING btree (activity_id);


--
-- Name: idx_medication_receptions_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_receptions_organization_id ON public.medication_receptions USING btree (organization_id);


--
-- Name: idx_medication_receptions_participant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_receptions_participant_id ON public.medication_receptions USING btree (participant_id);


--
-- Name: idx_medication_receptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_receptions_status ON public.medication_receptions USING btree (status);


--
-- Name: idx_medication_requirements_frequency_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_requirements_frequency_type ON public.medication_requirements USING btree (frequency_preset_type);


--
-- Name: idx_medication_requirements_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medication_requirements_org ON public.medication_requirements USING btree (organization_id);


--
-- Name: idx_oas_competencies_org_skill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oas_competencies_org_skill ON public.oas_competencies USING btree (organization_id, oas_skill_id);


--
-- Name: idx_oas_skills_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oas_skills_org ON public.oas_skills USING btree (organization_id);


--
-- Name: idx_oas_stages_org_skill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oas_stages_org_skill ON public.oas_stages USING btree (organization_id, oas_skill_id);


--
-- Name: idx_obj_achievements_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_achievements_meeting ON public.objective_achievements USING btree (meeting_id);


--
-- Name: idx_obj_achievements_obj; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_achievements_obj ON public.objective_achievements USING btree (objective_id);


--
-- Name: idx_obj_achievements_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_achievements_participant ON public.objective_achievements USING btree (participant_id);


--
-- Name: idx_org_form_formats_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_form_formats_category ON public.organization_form_formats USING btree (category);


--
-- Name: idx_org_form_formats_org_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_form_formats_org_type ON public.organization_form_formats USING btree (organization_id, form_type);


--
-- Name: idx_org_form_formats_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_form_formats_status ON public.organization_form_formats USING btree (status);


--
-- Name: idx_organization_domains_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_domains_domain ON public.organization_domains USING btree (domain);


--
-- Name: idx_organizations_program_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_program_section ON public.organizations USING btree (program_section);


--
-- Name: idx_pab_plan_items_org_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pab_plan_items_org_plan ON public.pab_plan_items USING btree (organization_id, pab_plan_id);


--
-- Name: idx_pab_plans_org_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pab_plans_org_participant ON public.pab_plans USING btree (organization_id, participant_id);


--
-- Name: idx_pab_reviews_org_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pab_reviews_org_plan ON public.pab_reviews USING btree (organization_id, pab_plan_id);


--
-- Name: idx_participant_credentials_org_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_credentials_org_participant ON public.participant_credentials USING btree (organization_id, participant_id);


--
-- Name: idx_participant_fees_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_fees_lookup ON public.participant_fees USING btree (participant_id, organization_id, fee_definition_id);


--
-- Name: idx_participant_groups_group_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_groups_group_org ON public.participant_group_assignments USING btree (group_id, organization_id);


--
-- Name: idx_participant_groups_participant_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_groups_participant_org ON public.participant_group_assignments USING btree (participant_id, organization_id);


--
-- Name: idx_participant_medications_org_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_medications_org_participant ON public.participant_medications USING btree (organization_id, participant_id);


--
-- Name: idx_participant_oas_comp_org_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_oas_comp_org_participant ON public.participant_oas_competency USING btree (organization_id, participant_id);


--
-- Name: idx_participant_oas_stage_org_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_oas_stage_org_participant ON public.participant_oas_stage_award USING btree (organization_id, participant_id);


--
-- Name: idx_participant_organizations_inscription_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_organizations_inscription_date ON public.participant_enrollments USING btree (inscription_date);


--
-- Name: idx_participant_orgs_participant_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_orgs_participant_org ON public.participant_enrollments USING btree (participant_id, organization_id);


--
-- Name: idx_participant_top_award_org_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_top_award_org_participant ON public.participant_top_award_progress USING btree (organization_id, participant_id);


--
-- Name: idx_participants_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_composite ON public.participants USING btree (id) INCLUDE (first_name, last_name, date_naissance);


--
-- Name: idx_participants_first_last_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_first_last_name ON public.participants USING btree (first_name, last_name);


--
-- Name: idx_payments_stripe_payment_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_stripe_payment_intent ON public.payments USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);


--
-- Name: idx_payments_stripe_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_stripe_transaction ON public.payments USING btree (stripe_transaction_id) WHERE (stripe_transaction_id IS NOT NULL);


--
-- Name: idx_permission_slips_activity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_slips_activity_id ON public.permission_slips USING btree (activity_id);


--
-- Name: idx_permission_slips_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_slips_deadline ON public.permission_slips USING btree (organization_id, deadline_date) WHERE ((deadline_date IS NOT NULL) AND ((status)::text = 'pending'::text));


--
-- Name: idx_permission_slips_email_tracking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_slips_email_tracking ON public.permission_slips USING btree (organization_id, meeting_date, email_sent, status) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_permission_slips_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_slips_org_date ON public.permission_slips USING btree (organization_id, meeting_date);


--
-- Name: idx_permission_slips_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_slips_status ON public.permission_slips USING btree (status);


--
-- Name: idx_permissions_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_category ON public.permissions USING btree (category);


--
-- Name: idx_permissions_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_key ON public.permissions USING btree (permission_key);


--
-- Name: idx_points; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points ON public.points USING btree (participant_id, organization_id);


--
-- Name: idx_points_group_org_partial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_group_org_partial ON public.points USING btree (group_id, organization_id) WHERE (participant_id IS NULL);


--
-- Name: idx_points_honor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_honor_id ON public.points USING btree (honor_id);


--
-- Name: idx_points_participant_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_participant_org ON public.points USING btree (participant_id, organization_id);


--
-- Name: idx_program_catalog_competencies_program_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_catalog_competencies_program_version ON public.program_catalog_competencies USING btree (program, version);


--
-- Name: idx_program_catalog_rules_program_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_catalog_rules_program_version ON public.program_catalog_rules USING btree (program, version);


--
-- Name: idx_program_catalog_skills_program_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_catalog_skills_program_version ON public.program_catalog_skills USING btree (program, version);


--
-- Name: idx_program_catalog_stages_program_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_catalog_stages_program_version ON public.program_catalog_stages USING btree (program, version);


--
-- Name: idx_program_catalog_versions_applied_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_catalog_versions_applied_at ON public.program_catalog_versions USING btree (applied_at DESC);


--
-- Name: idx_program_catalog_versions_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_catalog_versions_program ON public.program_catalog_versions USING btree (program);


--
-- Name: idx_progress_approvals_org_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_progress_approvals_org_source ON public.progress_approvals USING btree (organization_id, source_type, source_id);


--
-- Name: idx_progress_evidence_org_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_progress_evidence_org_source ON public.progress_evidence USING btree (organization_id, source_type, source_id);


--
-- Name: idx_reunion_prep_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reunion_prep_org_date ON public.reunion_preparations USING btree (organization_id, date);


--
-- Name: idx_reunion_preparations_organization_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reunion_preparations_organization_date ON public.reunion_preparations USING btree (organization_id, date);


--
-- Name: idx_role_permissions_permission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_permission ON public.role_permissions USING btree (permission_id);


--
-- Name: idx_role_permissions_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_role ON public.role_permissions USING btree (role_id);


--
-- Name: idx_roles_data_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_data_scope ON public.roles USING btree (data_scope);


--
-- Name: idx_submission_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_data ON public.form_submissions USING gin (submission_data);


--
-- Name: idx_submission_history_edited_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_history_edited_at ON public.form_submission_history USING btree (edited_at DESC);


--
-- Name: idx_submission_history_edited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_history_edited_by ON public.form_submission_history USING btree (edited_by);


--
-- Name: idx_submission_history_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_history_submission_id ON public.form_submission_history USING btree (form_submission_id);


--
-- Name: idx_top_award_projects_org_progress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_top_award_projects_org_progress ON public.top_award_projects USING btree (organization_id, participant_top_award_progress_id);


--
-- Name: idx_top_award_reviews_org_progress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_top_award_reviews_org_progress ON public.top_award_reviews USING btree (organization_id, participant_top_award_progress_id);


--
-- Name: idx_top_award_service_logs_org_progress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_top_award_service_logs_org_progress ON public.top_award_service_logs USING btree (organization_id, participant_top_award_progress_id);


--
-- Name: idx_top_awards_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_top_awards_org ON public.top_awards USING btree (organization_id);


--
-- Name: idx_trusted_devices_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_devices_expires ON public.trusted_devices USING btree (expires_at);


--
-- Name: idx_trusted_devices_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_devices_token ON public.trusted_devices USING btree (device_token, is_active);


--
-- Name: idx_trusted_devices_user_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_devices_user_org ON public.trusted_devices USING btree (user_id, organization_id, is_active);


--
-- Name: idx_two_factor_codes_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_two_factor_codes_expires ON public.two_factor_codes USING btree (expires_at);


--
-- Name: idx_two_factor_codes_user_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_two_factor_codes_user_org ON public.two_factor_codes USING btree (user_id, organization_id, verified);


--
-- Name: idx_user_organizations_role_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_organizations_role_ids ON public.user_organizations USING gin (role_ids);


--
-- Name: idx_user_organizations_user_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_organizations_user_org ON public.user_organizations USING btree (user_id, organization_id);


--
-- Name: idx_user_participants_user_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_participants_user_participant ON public.user_participants USING btree (user_id, participant_id);


--
-- Name: idx_users_language_preference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_language_preference ON public.users USING btree (language_preference) WHERE (language_preference IS NOT NULL);


--
-- Name: idx_users_whatsapp_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_whatsapp_phone ON public.users USING btree (whatsapp_phone_number) WHERE (whatsapp_phone_number IS NOT NULL);


--
-- Name: idx_whatsapp_auth_creds_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_auth_creds_gin ON public.whatsapp_baileys_connections USING gin (auth_creds);


--
-- Name: idx_whatsapp_auth_keys_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_auth_keys_gin ON public.whatsapp_baileys_connections USING gin (auth_keys);


--
-- Name: idx_whatsapp_baileys_connected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_baileys_connected ON public.whatsapp_baileys_connections USING btree (organization_id, is_connected) WHERE (is_connected = true);


--
-- Name: idx_whatsapp_baileys_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_baileys_org_id ON public.whatsapp_baileys_connections USING btree (organization_id);


--
-- Name: idx_year_plan_meetings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_meetings_date ON public.year_plan_meetings USING btree (organization_id, meeting_date);


--
-- Name: idx_year_plan_meetings_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_meetings_period ON public.year_plan_meetings USING btree (period_id);


--
-- Name: idx_year_plan_meetings_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_meetings_plan ON public.year_plan_meetings USING btree (year_plan_id);


--
-- Name: idx_year_plan_objectives_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_objectives_parent ON public.year_plan_objectives USING btree (parent_id);


--
-- Name: idx_year_plan_objectives_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_objectives_period ON public.year_plan_objectives USING btree (period_id);


--
-- Name: idx_year_plan_objectives_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_objectives_plan ON public.year_plan_objectives USING btree (year_plan_id);


--
-- Name: idx_year_plan_periods_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_periods_org ON public.year_plan_periods USING btree (organization_id);


--
-- Name: idx_year_plan_periods_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plan_periods_plan ON public.year_plan_periods USING btree (year_plan_id);


--
-- Name: idx_year_plans_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plans_dates ON public.year_plans USING btree (organization_id, start_date, end_date);


--
-- Name: idx_year_plans_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_year_plans_org ON public.year_plans USING btree (organization_id);


--
-- Name: idx_yp_reminders_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_yp_reminders_meeting ON public.year_plan_reminders USING btree (meeting_id);


--
-- Name: idx_yp_reminders_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_yp_reminders_org ON public.year_plan_reminders USING btree (organization_id, created_at DESC);


--
-- Name: idx_yp_reminders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_yp_reminders_status ON public.year_plan_reminders USING btree (status, scheduled_at);


--
-- Name: idx_ypm_activities_meeting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ypm_activities_meeting ON public.year_plan_meeting_activities USING btree (meeting_id);


--
-- Name: idx_ypm_activities_series; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ypm_activities_series ON public.year_plan_meeting_activities USING btree (series_id);


--
-- Name: idx_ypm_activities_unprocessed_badges; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ypm_activities_unprocessed_badges ON public.year_plan_meeting_activities USING btree (organization_id, badge_template_id) WHERE ((badge_template_id IS NOT NULL) AND (processed = false));


--
-- Name: medication_admin_auth_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX medication_admin_auth_year_idx ON public.medication_admin_authorizations USING btree (organization_id, participant_id, scout_year_id);


--
-- Name: medication_treatment_auth_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX medication_treatment_auth_year_idx ON public.medication_treatment_authorizations USING btree (organization_id, participant_id, scout_year_id);


--
-- Name: participant_enrollments_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participant_enrollments_participant_idx ON public.participant_enrollments USING btree (participant_id);


--
-- Name: participant_enrollments_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participant_enrollments_year_idx ON public.participant_enrollments USING btree (organization_id, scout_year_id, status);


--
-- Name: participant_group_assignments_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participant_group_assignments_year_idx ON public.participant_group_assignments USING btree (organization_id, scout_year_id, group_id);


--
-- Name: points_scout_year_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX points_scout_year_group_idx ON public.points USING btree (organization_id, scout_year_id, group_id);


--
-- Name: points_scout_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX points_scout_year_idx ON public.points USING btree (organization_id, scout_year_id, participant_id);


--
-- Name: scout_year_transitions_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_year_transitions_org_idx ON public.scout_year_transitions USING btree (organization_id, executed_at DESC);


--
-- Name: scout_years_one_active_per_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scout_years_one_active_per_org ON public.scout_years USING btree (organization_id) WHERE (status = 'active'::text);


--
-- Name: scout_years_org_range_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_years_org_range_idx ON public.scout_years USING btree (organization_id, start_date, end_date);


--
-- Name: uniq_year_plan_meetings_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_year_plan_meetings_org_date ON public.year_plan_meetings USING btree (organization_id, meeting_date);


--
-- Name: uq_badge_progress_oas_stage_presentation_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_badge_progress_oas_stage_presentation_once ON public.badge_progress USING btree (participant_id, badge_template_id) WHERE (((source_type)::text = 'oas_stage'::text) AND (source_id IS NULL) AND (attempt_no = 1));


--
-- Name: uq_badge_progress_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_badge_progress_source ON public.badge_progress USING btree (participant_id, badge_template_id, source_type, source_id) WHERE ((source_type IS NOT NULL) AND (source_id IS NOT NULL));


--
-- Name: uq_medreq_org_name_start; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_medreq_org_name_start ON public.medication_requirements USING btree (organization_id, medication_name, COALESCE(start_date, '0001-01-01'::date));


--
-- Name: user_organizations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_organizations_status_idx ON public.user_organizations USING btree (organization_id, status);


--
-- Name: activities activities_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER activities_updated_at_trigger BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.update_activities_updated_at();


--
-- Name: announcements announcement_scheduled_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER announcement_scheduled_insert AFTER INSERT ON public.announcements FOR EACH ROW WHEN (((new.status)::text = 'scheduled'::text)) EXECUTE FUNCTION public.notify_announcement_scheduled();


--
-- Name: TRIGGER announcement_scheduled_insert ON announcements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER announcement_scheduled_insert ON public.announcements IS 'Sends notification when new announcements are scheduled';


--
-- Name: announcements announcement_scheduled_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER announcement_scheduled_update AFTER UPDATE ON public.announcements FOR EACH ROW WHEN ((((new.status)::text = 'scheduled'::text) AND (((old.status)::text IS DISTINCT FROM 'scheduled'::text) OR (old.scheduled_at IS DISTINCT FROM new.scheduled_at)))) EXECUTE FUNCTION public.notify_announcement_scheduled();


--
-- Name: TRIGGER announcement_scheduled_update ON announcements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER announcement_scheduled_update ON public.announcements IS 'Sends notification when announcements are updated to scheduled status';


--
-- Name: carpool_assignments carpool_assignments_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER carpool_assignments_updated_at_trigger BEFORE UPDATE ON public.carpool_assignments FOR EACH ROW EXECUTE FUNCTION public.update_carpool_assignments_updated_at();


--
-- Name: carpool_offers carpool_offers_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER carpool_offers_updated_at_trigger BEFORE UPDATE ON public.carpool_offers FOR EACH ROW EXECUTE FUNCTION public.update_carpool_offers_updated_at();


--
-- Name: carpool_assignments check_carpool_seat_availability_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_carpool_seat_availability_trigger BEFORE INSERT OR UPDATE ON public.carpool_assignments FOR EACH ROW EXECUTE FUNCTION public.check_carpool_seat_availability();


--
-- Name: form_submissions form_submission_audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER form_submission_audit_trigger BEFORE UPDATE ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION public.create_form_submission_audit_trail();


--
-- Name: form_submissions form_submissions_set_scout_year_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER form_submissions_set_scout_year_trigger BEFORE INSERT ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION public.form_submissions_set_scout_year();


--
-- Name: google_chat_config google_chat_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER google_chat_config_updated_at BEFORE UPDATE ON public.google_chat_config FOR EACH ROW EXECUTE FUNCTION public.update_google_chat_updated_at();


--
-- Name: google_chat_spaces google_chat_spaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER google_chat_spaces_updated_at BEFORE UPDATE ON public.google_chat_spaces FOR EACH ROW EXECUTE FUNCTION public.update_google_chat_updated_at();


--
-- Name: incident_reports incident_reports_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER incident_reports_updated_at_trigger BEFORE UPDATE ON public.incident_reports FOR EACH ROW EXECUTE FUNCTION public.update_incident_reports_updated_at();


--
-- Name: medication_admin_authorizations medication_admin_auth_year_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER medication_admin_auth_year_trigger BEFORE INSERT ON public.medication_admin_authorizations FOR EACH ROW EXECUTE FUNCTION public.medication_authorization_set_scout_year();


--
-- Name: medication_receptions medication_receptions_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER medication_receptions_updated_at_trigger BEFORE UPDATE ON public.medication_receptions FOR EACH ROW EXECUTE FUNCTION public.update_medication_receptions_updated_at();


--
-- Name: medication_treatment_authorizations medication_treatment_auth_year_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER medication_treatment_auth_year_trigger BEFORE INSERT ON public.medication_treatment_authorizations FOR EACH ROW EXECUTE FUNCTION public.medication_authorization_set_scout_year();


--
-- Name: participant_groups participant_groups_delete_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_groups_delete_trigger INSTEAD OF DELETE ON public.participant_groups FOR EACH ROW EXECUTE FUNCTION public.participant_groups_delete();


--
-- Name: participant_groups participant_groups_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_groups_insert_trigger INSTEAD OF INSERT ON public.participant_groups FOR EACH ROW EXECUTE FUNCTION public.participant_groups_insert();


--
-- Name: participant_groups participant_groups_update_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_groups_update_trigger INSTEAD OF UPDATE ON public.participant_groups FOR EACH ROW EXECUTE FUNCTION public.participant_groups_update();


--
-- Name: participant_organizations participant_organizations_delete_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_organizations_delete_trigger INSTEAD OF DELETE ON public.participant_organizations FOR EACH ROW EXECUTE FUNCTION public.participant_organizations_delete();


--
-- Name: participant_organizations participant_organizations_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_organizations_insert_trigger INSTEAD OF INSERT ON public.participant_organizations FOR EACH ROW EXECUTE FUNCTION public.participant_organizations_insert();


--
-- Name: participant_organizations participant_organizations_update_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_organizations_update_trigger INSTEAD OF UPDATE ON public.participant_organizations FOR EACH ROW EXECUTE FUNCTION public.participant_organizations_update();


--
-- Name: points points_set_scout_year_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER points_set_scout_year_trigger BEFORE INSERT ON public.points FOR EACH ROW EXECUTE FUNCTION public.points_set_scout_year();


--
-- Name: budget_categories update_budget_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_budget_categories_updated_at BEFORE UPDATE ON public.budget_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: budget_expenses update_budget_expenses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_budget_expenses_updated_at BEFORE UPDATE ON public.budget_expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: budget_items update_budget_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_budget_items_updated_at BEFORE UPDATE ON public.budget_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: budget_plans update_budget_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_budget_plans_updated_at BEFORE UPDATE ON public.budget_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: budget_revenues update_budget_revenues_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_budget_revenues_updated_at BEFORE UPDATE ON public.budget_revenues FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: roles update_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: activities activities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: activities activities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: activity_distribution_rules activity_distribution_rules_activity_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_distribution_rules
    ADD CONSTRAINT activity_distribution_rules_activity_library_id_fkey FOREIGN KEY (activity_library_id) REFERENCES public.activity_library(id) ON DELETE SET NULL;


--
-- Name: activity_distribution_rules activity_distribution_rules_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_distribution_rules
    ADD CONSTRAINT activity_distribution_rules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: activity_distribution_rules activity_distribution_rules_year_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_distribution_rules
    ADD CONSTRAINT activity_distribution_rules_year_plan_id_fkey FOREIGN KEY (year_plan_id) REFERENCES public.year_plans(id) ON DELETE CASCADE;


--
-- Name: activity_library activity_library_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_library
    ADD CONSTRAINT activity_library_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: activity_library activity_library_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_library
    ADD CONSTRAINT activity_library_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: announcement_logs announcement_logs_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_logs
    ADD CONSTRAINT announcement_logs_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: announcements announcements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: attendance attendance_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: badge_progress badge_progress_badge_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_progress
    ADD CONSTRAINT badge_progress_badge_template_id_fkey FOREIGN KEY (badge_template_id) REFERENCES public.badge_templates(id);


--
-- Name: badge_progress badge_progress_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_progress
    ADD CONSTRAINT badge_progress_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: badge_templates badge_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_templates
    ADD CONSTRAINT badge_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: budget_categories budget_categories_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_categories
    ADD CONSTRAINT budget_categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: budget_expenses budget_expenses_budget_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_expenses
    ADD CONSTRAINT budget_expenses_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id);


--
-- Name: budget_expenses budget_expenses_budget_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_expenses
    ADD CONSTRAINT budget_expenses_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items(id);


--
-- Name: budget_expenses budget_expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_expenses
    ADD CONSTRAINT budget_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: budget_expenses budget_expenses_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_expenses
    ADD CONSTRAINT budget_expenses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: budget_items budget_items_budget_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_items
    ADD CONSTRAINT budget_items_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id) ON DELETE CASCADE;


--
-- Name: budget_items budget_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_items
    ADD CONSTRAINT budget_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: budget_plans budget_plans_budget_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_plans
    ADD CONSTRAINT budget_plans_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items(id);


--
-- Name: budget_plans budget_plans_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_plans
    ADD CONSTRAINT budget_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: budget_revenues budget_revenues_budget_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_revenues
    ADD CONSTRAINT budget_revenues_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id);


--
-- Name: budget_revenues budget_revenues_budget_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_revenues
    ADD CONSTRAINT budget_revenues_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items(id);


--
-- Name: budget_revenues budget_revenues_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_revenues
    ADD CONSTRAINT budget_revenues_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: budget_revenues budget_revenues_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_revenues
    ADD CONSTRAINT budget_revenues_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: carpool_assignments carpool_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_assignments
    ADD CONSTRAINT carpool_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: carpool_assignments carpool_assignments_carpool_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_assignments
    ADD CONSTRAINT carpool_assignments_carpool_offer_id_fkey FOREIGN KEY (carpool_offer_id) REFERENCES public.carpool_offers(id) ON DELETE CASCADE;


--
-- Name: carpool_assignments carpool_assignments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_assignments
    ADD CONSTRAINT carpool_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: carpool_assignments carpool_assignments_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_assignments
    ADD CONSTRAINT carpool_assignments_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: carpool_offers carpool_offers_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_offers
    ADD CONSTRAINT carpool_offers_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: carpool_offers carpool_offers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_offers
    ADD CONSTRAINT carpool_offers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: carpool_offers carpool_offers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carpool_offers
    ADD CONSTRAINT carpool_offers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: equipment_item_organizations equipment_item_organizations_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_item_organizations
    ADD CONSTRAINT equipment_item_organizations_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_items(id) ON DELETE CASCADE;


--
-- Name: equipment_item_organizations equipment_item_organizations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_item_organizations
    ADD CONSTRAINT equipment_item_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: equipment_items equipment_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_items
    ADD CONSTRAINT equipment_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: equipment_reservations equipment_reservations_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: equipment_reservations equipment_reservations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: equipment_reservations equipment_reservations_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_items(id) ON DELETE CASCADE;


--
-- Name: equipment_reservations equipment_reservations_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.year_plan_meetings(id) ON DELETE SET NULL;


--
-- Name: equipment_reservations equipment_reservations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_reservations
    ADD CONSTRAINT equipment_reservations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: erasure_log erasure_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erasure_log
    ADD CONSTRAINT erasure_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: erasure_log erasure_log_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erasure_log
    ADD CONSTRAINT erasure_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- Name: fee_definitions fee_definitions_budget_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_definitions
    ADD CONSTRAINT fee_definitions_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id);


--
-- Name: fee_definitions fee_definitions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_definitions
    ADD CONSTRAINT fee_definitions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: first_aid_supplies first_aid_supplies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.first_aid_supplies
    ADD CONSTRAINT first_aid_supplies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_form_formats fk_current_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_form_formats
    ADD CONSTRAINT fk_current_version FOREIGN KEY (current_version_id) REFERENCES public.form_format_versions(id) ON DELETE SET NULL;


--
-- Name: program_catalog_competencies fk_program_catalog_competencies_skill; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_competencies
    ADD CONSTRAINT fk_program_catalog_competencies_skill FOREIGN KEY (program, version, official_key) REFERENCES public.program_catalog_skills(program, version, official_key) ON DELETE RESTRICT;


--
-- Name: program_catalog_competencies fk_program_catalog_competencies_stage; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_competencies
    ADD CONSTRAINT fk_program_catalog_competencies_stage FOREIGN KEY (program, version, stage_no) REFERENCES public.program_catalog_stages(program, version, stage_no) ON DELETE RESTRICT;


--
-- Name: program_catalog_competencies fk_program_catalog_competencies_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_competencies
    ADD CONSTRAINT fk_program_catalog_competencies_version FOREIGN KEY (program, version) REFERENCES public.program_catalog_versions(program, version) ON DELETE CASCADE;


--
-- Name: program_catalog_rules fk_program_catalog_rules_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_rules
    ADD CONSTRAINT fk_program_catalog_rules_version FOREIGN KEY (program, version) REFERENCES public.program_catalog_versions(program, version) ON DELETE CASCADE;


--
-- Name: program_catalog_skills fk_program_catalog_skills_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_skills
    ADD CONSTRAINT fk_program_catalog_skills_version FOREIGN KEY (program, version) REFERENCES public.program_catalog_versions(program, version) ON DELETE CASCADE;


--
-- Name: program_catalog_stages fk_program_catalog_stages_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_catalog_stages
    ADD CONSTRAINT fk_program_catalog_stages_version FOREIGN KEY (program, version) REFERENCES public.program_catalog_versions(program, version) ON DELETE CASCADE;


--
-- Name: form_format_versions form_format_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_format_versions
    ADD CONSTRAINT form_format_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: form_format_versions form_format_versions_form_format_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_format_versions
    ADD CONSTRAINT form_format_versions_form_format_id_fkey FOREIGN KEY (form_format_id) REFERENCES public.organization_form_formats(id) ON DELETE CASCADE;


--
-- Name: form_permissions form_permissions_form_format_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_permissions
    ADD CONSTRAINT form_permissions_form_format_id_fkey FOREIGN KEY (form_format_id) REFERENCES public.organization_form_formats(id) ON DELETE CASCADE;


--
-- Name: form_permissions form_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_permissions
    ADD CONSTRAINT form_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: form_submission_history form_submission_history_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submission_history
    ADD CONSTRAINT form_submission_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id);


--
-- Name: form_submission_history form_submission_history_form_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submission_history
    ADD CONSTRAINT form_submission_history_form_submission_id_fkey FOREIGN KEY (form_submission_id) REFERENCES public.form_submissions(id) ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_form_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_form_version_id_fkey FOREIGN KEY (form_version_id) REFERENCES public.form_format_versions(id);


--
-- Name: form_submissions form_submissions_last_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_last_reviewed_by_fkey FOREIGN KEY (last_reviewed_by) REFERENCES public.users(id);


--
-- Name: form_submissions form_submissions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: form_submissions form_submissions_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: form_submissions form_submissions_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_scout_year_id_fkey FOREIGN KEY (scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: form_submissions form_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fundraiser_entries fundraiser_entries_fundraiser_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundraiser_entries
    ADD CONSTRAINT fundraiser_entries_fundraiser_fkey FOREIGN KEY (fundraiser) REFERENCES public.fundraisers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fundraiser_entries fundraiser_entries_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundraiser_entries
    ADD CONSTRAINT fundraiser_entries_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fundraisers fundraisers_budget_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundraisers
    ADD CONSTRAINT fundraisers_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id);


--
-- Name: fundraisers fundraisers_organization_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundraisers
    ADD CONSTRAINT fundraisers_organization_fkey FOREIGN KEY (organization) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: google_chat_config google_chat_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_config
    ADD CONSTRAINT google_chat_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: google_chat_messages google_chat_messages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_messages
    ADD CONSTRAINT google_chat_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: google_chat_messages google_chat_messages_sent_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_messages
    ADD CONSTRAINT google_chat_messages_sent_by_user_id_fkey FOREIGN KEY (sent_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: google_chat_spaces google_chat_spaces_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_spaces
    ADD CONSTRAINT google_chat_spaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: groups groups_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: guardian_users guardian_users_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_users
    ADD CONSTRAINT guardian_users_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id);


--
-- Name: guardian_users guardian_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_users
    ADD CONSTRAINT guardian_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: guests guests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: honors honors_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors
    ADD CONSTRAINT honors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: honors honors_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors
    ADD CONSTRAINT honors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: honors honors_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors
    ADD CONSTRAINT honors_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: honors honors_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honors
    ADD CONSTRAINT honors_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: incident_email_queue incident_email_queue_incident_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_email_queue
    ADD CONSTRAINT incident_email_queue_incident_fkey FOREIGN KEY (incident_report_id) REFERENCES public.incident_reports(id) ON DELETE CASCADE;


--
-- Name: incident_email_queue incident_email_queue_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_email_queue
    ADD CONSTRAINT incident_email_queue_org_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: incident_escalation_contacts incident_escalation_contacts_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_escalation_contacts
    ADD CONSTRAINT incident_escalation_contacts_org_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: incident_reports incident_reports_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_form_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_form_submission_id_fkey FOREIGN KEY (form_submission_id) REFERENCES public.form_submissions(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: incident_reports incident_reports_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_victim_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_victim_participant_id_fkey FOREIGN KEY (victim_participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_victim_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_victim_user_id_fkey FOREIGN KEY (victim_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: medication_admin_authorizations maa_admin_user_id_1_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT maa_admin_user_id_1_fkey FOREIGN KEY (admin_user_id_1) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: medication_admin_authorizations maa_admin_user_id_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT maa_admin_user_id_2_fkey FOREIGN KEY (admin_user_id_2) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: medication_admin_authorizations maa_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT maa_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: medication_admin_authorizations maa_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT maa_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id) ON DELETE RESTRICT;


--
-- Name: medication_admin_authorizations maa_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT maa_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: medication_admin_authorizations maa_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT maa_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: medication_admin_authorization_requirements maar_authorization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorization_requirements
    ADD CONSTRAINT maar_authorization_id_fkey FOREIGN KEY (authorization_id) REFERENCES public.medication_admin_authorizations(id) ON DELETE CASCADE;


--
-- Name: medication_admin_authorization_requirements maar_medication_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorization_requirements
    ADD CONSTRAINT maar_medication_requirement_id_fkey FOREIGN KEY (medication_requirement_id) REFERENCES public.medication_requirements(id) ON DELETE CASCADE;


--
-- Name: medication_admin_authorizations medication_admin_authorizations_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_admin_authorizations
    ADD CONSTRAINT medication_admin_authorizations_scout_year_id_fkey FOREIGN KEY (scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: medication_distributions medication_distributions_administered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions
    ADD CONSTRAINT medication_distributions_administered_by_fkey FOREIGN KEY (administered_by) REFERENCES public.users(id);


--
-- Name: medication_distributions medication_distributions_medication_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions
    ADD CONSTRAINT medication_distributions_medication_requirement_id_fkey FOREIGN KEY (medication_requirement_id) REFERENCES public.medication_requirements(id) ON DELETE CASCADE;


--
-- Name: medication_distributions medication_distributions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions
    ADD CONSTRAINT medication_distributions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: medication_distributions medication_distributions_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions
    ADD CONSTRAINT medication_distributions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: medication_distributions medication_distributions_participant_medication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_distributions
    ADD CONSTRAINT medication_distributions_participant_medication_id_fkey FOREIGN KEY (participant_medication_id) REFERENCES public.participant_medications(id) ON DELETE SET NULL;


--
-- Name: medication_receptions medication_receptions_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_receptions
    ADD CONSTRAINT medication_receptions_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: medication_receptions medication_receptions_medication_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_receptions
    ADD CONSTRAINT medication_receptions_medication_requirement_id_fkey FOREIGN KEY (medication_requirement_id) REFERENCES public.medication_requirements(id) ON DELETE CASCADE;


--
-- Name: medication_receptions medication_receptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_receptions
    ADD CONSTRAINT medication_receptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: medication_receptions medication_receptions_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_receptions
    ADD CONSTRAINT medication_receptions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: medication_receptions medication_receptions_participant_medication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_receptions
    ADD CONSTRAINT medication_receptions_participant_medication_id_fkey FOREIGN KEY (participant_medication_id) REFERENCES public.participant_medications(id) ON DELETE SET NULL;


--
-- Name: medication_receptions medication_receptions_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_receptions
    ADD CONSTRAINT medication_receptions_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: medication_requirements medication_requirements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_requirements
    ADD CONSTRAINT medication_requirements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: medication_requirements medication_requirements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_requirements
    ADD CONSTRAINT medication_requirements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: medication_requirements medication_requirements_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_requirements
    ADD CONSTRAINT medication_requirements_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: medication_treatment_authorizations medication_treatment_authorizations_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorizations
    ADD CONSTRAINT medication_treatment_authorizations_scout_year_id_fkey FOREIGN KEY (scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: medication_treatment_authorizations mta_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorizations
    ADD CONSTRAINT mta_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: medication_treatment_authorizations mta_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorizations
    ADD CONSTRAINT mta_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id) ON DELETE RESTRICT;


--
-- Name: medication_treatment_authorizations mta_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorizations
    ADD CONSTRAINT mta_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: medication_treatment_authorizations mta_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorizations
    ADD CONSTRAINT mta_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: medication_treatment_authorization_supplies mtas_authorization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorization_supplies
    ADD CONSTRAINT mtas_authorization_id_fkey FOREIGN KEY (authorization_id) REFERENCES public.medication_treatment_authorizations(id) ON DELETE CASCADE;


--
-- Name: medication_treatment_authorization_supplies mtas_first_aid_supply_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medication_treatment_authorization_supplies
    ADD CONSTRAINT mtas_first_aid_supply_id_fkey FOREIGN KEY (first_aid_supply_id) REFERENCES public.first_aid_supplies(id) ON DELETE CASCADE;


--
-- Name: news news_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news
    ADD CONSTRAINT news_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: oas_competencies oas_competencies_oas_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_competencies
    ADD CONSTRAINT oas_competencies_oas_skill_id_fkey FOREIGN KEY (oas_skill_id) REFERENCES public.oas_skills(id) ON DELETE CASCADE;


--
-- Name: oas_competencies oas_competencies_oas_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_competencies
    ADD CONSTRAINT oas_competencies_oas_stage_id_fkey FOREIGN KEY (oas_stage_id) REFERENCES public.oas_stages(id) ON DELETE SET NULL;


--
-- Name: oas_competencies oas_competencies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_competencies
    ADD CONSTRAINT oas_competencies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: oas_skills oas_skills_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_skills
    ADD CONSTRAINT oas_skills_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: oas_stages oas_stages_oas_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_stages
    ADD CONSTRAINT oas_stages_oas_skill_id_fkey FOREIGN KEY (oas_skill_id) REFERENCES public.oas_skills(id) ON DELETE CASCADE;


--
-- Name: oas_stages oas_stages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oas_stages
    ADD CONSTRAINT oas_stages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: objective_achievements objective_achievements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements
    ADD CONSTRAINT objective_achievements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: objective_achievements objective_achievements_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements
    ADD CONSTRAINT objective_achievements_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.year_plan_meetings(id) ON DELETE SET NULL;


--
-- Name: objective_achievements objective_achievements_objective_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements
    ADD CONSTRAINT objective_achievements_objective_id_fkey FOREIGN KEY (objective_id) REFERENCES public.year_plan_objectives(id) ON DELETE CASCADE;


--
-- Name: objective_achievements objective_achievements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements
    ADD CONSTRAINT objective_achievements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: objective_achievements objective_achievements_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objective_achievements
    ADD CONSTRAINT objective_achievements_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: organization_domains organization_domains_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_domains
    ADD CONSTRAINT organization_domains_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_form_formats organization_form_formats_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_form_formats
    ADD CONSTRAINT organization_form_formats_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: organization_form_formats organization_form_formats_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_form_formats
    ADD CONSTRAINT organization_form_formats_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_local_groups organization_local_groups_local_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_local_groups
    ADD CONSTRAINT organization_local_groups_local_group_id_fkey FOREIGN KEY (local_group_id) REFERENCES public.local_groups(id) ON DELETE CASCADE;


--
-- Name: organization_local_groups organization_local_groups_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_local_groups
    ADD CONSTRAINT organization_local_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_program_sections organization_program_sections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_program_sections
    ADD CONSTRAINT organization_program_sections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_settings organization_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organizations organizations_program_section_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_program_section_fk FOREIGN KEY (id, program_section) REFERENCES public.organization_program_sections(organization_id, section_key) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: pab_plan_items pab_plan_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plan_items
    ADD CONSTRAINT pab_plan_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pab_plan_items pab_plan_items_pab_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plan_items
    ADD CONSTRAINT pab_plan_items_pab_plan_id_fkey FOREIGN KEY (pab_plan_id) REFERENCES public.pab_plans(id) ON DELETE CASCADE;


--
-- Name: pab_plans pab_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plans
    ADD CONSTRAINT pab_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pab_plans pab_plans_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plans
    ADD CONSTRAINT pab_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pab_plans pab_plans_pab_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plans
    ADD CONSTRAINT pab_plans_pab_theme_id_fkey FOREIGN KEY (pab_theme_id) REFERENCES public.pab_themes(id) ON DELETE SET NULL;


--
-- Name: pab_plans pab_plans_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_plans
    ADD CONSTRAINT pab_plans_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: pab_reviews pab_reviews_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_reviews
    ADD CONSTRAINT pab_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pab_reviews pab_reviews_pab_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_reviews
    ADD CONSTRAINT pab_reviews_pab_plan_id_fkey FOREIGN KEY (pab_plan_id) REFERENCES public.pab_plans(id) ON DELETE CASCADE;


--
-- Name: pab_reviews pab_reviews_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_reviews
    ADD CONSTRAINT pab_reviews_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: pab_reviews pab_reviews_reviewer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_reviews
    ADD CONSTRAINT pab_reviews_reviewer_user_id_fkey FOREIGN KEY (reviewer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pab_themes pab_themes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pab_themes
    ADD CONSTRAINT pab_themes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: participant_credentials participant_credentials_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_credentials
    ADD CONSTRAINT participant_credentials_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: participant_credentials participant_credentials_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_credentials
    ADD CONSTRAINT participant_credentials_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: participant_credentials participant_credentials_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_credentials
    ADD CONSTRAINT participant_credentials_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: participant_enrollments participant_enrollments_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_enrollments
    ADD CONSTRAINT participant_enrollments_scout_year_id_fkey FOREIGN KEY (scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: participant_enrollments participant_enrollments_transferred_to_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_enrollments
    ADD CONSTRAINT participant_enrollments_transferred_to_organization_id_fkey FOREIGN KEY (transferred_to_organization_id) REFERENCES public.organizations(id);


--
-- Name: participant_fees participant_fees_fee_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_fees
    ADD CONSTRAINT participant_fees_fee_definition_id_fkey FOREIGN KEY (fee_definition_id) REFERENCES public.fee_definitions(id);


--
-- Name: participant_fees participant_fees_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_fees
    ADD CONSTRAINT participant_fees_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: participant_fees participant_fees_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_fees
    ADD CONSTRAINT participant_fees_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id);


--
-- Name: participant_group_assignments participant_group_assignments_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_group_assignments
    ADD CONSTRAINT participant_group_assignments_scout_year_id_fkey FOREIGN KEY (scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: participant_group_assignments participant_groups_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_group_assignments
    ADD CONSTRAINT participant_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: participant_group_assignments participant_groups_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_group_assignments
    ADD CONSTRAINT participant_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: participant_group_assignments participant_groups_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_group_assignments
    ADD CONSTRAINT participant_groups_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: participant_guardians participant_guardians_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_guardians
    ADD CONSTRAINT participant_guardians_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id) ON DELETE CASCADE;


--
-- Name: participant_guardians participant_guardians_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_guardians
    ADD CONSTRAINT participant_guardians_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: participant_medications participant_medications_medication_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_medications
    ADD CONSTRAINT participant_medications_medication_requirement_id_fkey FOREIGN KEY (medication_requirement_id) REFERENCES public.medication_requirements(id) ON DELETE CASCADE;


--
-- Name: participant_medications participant_medications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_medications
    ADD CONSTRAINT participant_medications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: participant_medications participant_medications_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_medications
    ADD CONSTRAINT participant_medications_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: participant_oas_competency participant_oas_competency_awarded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_competency
    ADD CONSTRAINT participant_oas_competency_awarded_by_fkey FOREIGN KEY (awarded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: participant_oas_competency participant_oas_competency_oas_competency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_competency
    ADD CONSTRAINT participant_oas_competency_oas_competency_id_fkey FOREIGN KEY (oas_competency_id) REFERENCES public.oas_competencies(id) ON DELETE CASCADE;


--
-- Name: participant_oas_competency participant_oas_competency_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_competency
    ADD CONSTRAINT participant_oas_competency_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: participant_oas_competency participant_oas_competency_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_competency
    ADD CONSTRAINT participant_oas_competency_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: participant_oas_stage_award participant_oas_stage_award_awarded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_stage_award
    ADD CONSTRAINT participant_oas_stage_award_awarded_by_fkey FOREIGN KEY (awarded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: participant_oas_stage_award participant_oas_stage_award_oas_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_stage_award
    ADD CONSTRAINT participant_oas_stage_award_oas_stage_id_fkey FOREIGN KEY (oas_stage_id) REFERENCES public.oas_stages(id) ON DELETE CASCADE;


--
-- Name: participant_oas_stage_award participant_oas_stage_award_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_stage_award
    ADD CONSTRAINT participant_oas_stage_award_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: participant_oas_stage_award participant_oas_stage_award_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_oas_stage_award
    ADD CONSTRAINT participant_oas_stage_award_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: participant_enrollments participant_organizations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_enrollments
    ADD CONSTRAINT participant_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: participant_enrollments participant_organizations_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_enrollments
    ADD CONSTRAINT participant_organizations_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: participant_top_award_progress participant_top_award_progress_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_top_award_progress
    ADD CONSTRAINT participant_top_award_progress_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: participant_top_award_progress participant_top_award_progress_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_top_award_progress
    ADD CONSTRAINT participant_top_award_progress_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: participant_top_award_progress participant_top_award_progress_top_award_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_top_award_progress
    ADD CONSTRAINT participant_top_award_progress_top_award_id_fkey FOREIGN KEY (top_award_id) REFERENCES public.top_awards(id) ON DELETE CASCADE;


--
-- Name: payment_plans payment_plans_participant_fee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plans
    ADD CONSTRAINT payment_plans_participant_fee_id_fkey FOREIGN KEY (participant_fee_id) REFERENCES public.participant_fees(id) ON DELETE CASCADE;


--
-- Name: payments payments_participant_fee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_participant_fee_id_fkey FOREIGN KEY (participant_fee_id) REFERENCES public.participant_fees(id) ON DELETE CASCADE;


--
-- Name: payments payments_payment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_payment_plan_id_fkey FOREIGN KEY (payment_plan_id) REFERENCES public.payment_plans(id);


--
-- Name: permission_slips permission_slips_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: permission_slips permission_slips_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id);


--
-- Name: permission_slips permission_slips_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.year_plan_meetings(id) ON DELETE SET NULL;


--
-- Name: permission_slips permission_slips_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: permission_slips permission_slips_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_slips
    ADD CONSTRAINT permission_slips_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: points points_honor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_honor_id_fkey FOREIGN KEY (honor_id) REFERENCES public.honors(id) ON DELETE CASCADE;


--
-- Name: points points_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: points points_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: points points_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points
    ADD CONSTRAINT points_scout_year_id_fkey FOREIGN KEY (scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: progress_approvals progress_approvals_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_approvals
    ADD CONSTRAINT progress_approvals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: progress_approvals progress_approvals_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_approvals
    ADD CONSTRAINT progress_approvals_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;


--
-- Name: progress_approvals progress_approvals_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_approvals
    ADD CONSTRAINT progress_approvals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: progress_evidence progress_evidence_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_evidence
    ADD CONSTRAINT progress_evidence_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: progress_evidence progress_evidence_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_evidence
    ADD CONSTRAINT progress_evidence_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: progress_evidence progress_evidence_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.progress_evidence
    ADD CONSTRAINT progress_evidence_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;


--
-- Name: rappel_reunion rappel_reunion_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rappel_reunion
    ADD CONSTRAINT rappel_reunion_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: reunion_preparations reunion_preparations_animateur_responsable_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunion_preparations
    ADD CONSTRAINT reunion_preparations_animateur_responsable_fkey FOREIGN KEY (animateur_responsable) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reunion_preparations reunion_preparations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunion_preparations
    ADD CONSTRAINT reunion_preparations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: scout_year_transitions scout_year_transitions_executed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_year_transitions
    ADD CONSTRAINT scout_year_transitions_executed_by_fkey FOREIGN KEY (executed_by) REFERENCES public.users(id);


--
-- Name: scout_year_transitions scout_year_transitions_from_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_year_transitions
    ADD CONSTRAINT scout_year_transitions_from_scout_year_id_fkey FOREIGN KEY (from_scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: scout_year_transitions scout_year_transitions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_year_transitions
    ADD CONSTRAINT scout_year_transitions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: scout_year_transitions scout_year_transitions_rolled_back_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_year_transitions
    ADD CONSTRAINT scout_year_transitions_rolled_back_by_fkey FOREIGN KEY (rolled_back_by) REFERENCES public.users(id);


--
-- Name: scout_year_transitions scout_year_transitions_to_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_year_transitions
    ADD CONSTRAINT scout_year_transitions_to_scout_year_id_fkey FOREIGN KEY (to_scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: scout_years scout_years_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_years
    ADD CONSTRAINT scout_years_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id);


--
-- Name: scout_years scout_years_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_years
    ADD CONSTRAINT scout_years_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: subscribers subscribers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: subscribers subscribers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: top_award_projects top_award_projects_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_projects
    ADD CONSTRAINT top_award_projects_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: top_award_projects top_award_projects_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_projects
    ADD CONSTRAINT top_award_projects_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: top_award_projects top_award_projects_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_projects
    ADD CONSTRAINT top_award_projects_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: top_award_projects top_award_projects_participant_top_award_progress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_projects
    ADD CONSTRAINT top_award_projects_participant_top_award_progress_id_fkey FOREIGN KEY (participant_top_award_progress_id) REFERENCES public.participant_top_award_progress(id) ON DELETE CASCADE;


--
-- Name: top_award_reviews top_award_reviews_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_reviews
    ADD CONSTRAINT top_award_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: top_award_reviews top_award_reviews_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_reviews
    ADD CONSTRAINT top_award_reviews_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: top_award_reviews top_award_reviews_participant_top_award_progress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_reviews
    ADD CONSTRAINT top_award_reviews_participant_top_award_progress_id_fkey FOREIGN KEY (participant_top_award_progress_id) REFERENCES public.participant_top_award_progress(id) ON DELETE CASCADE;


--
-- Name: top_award_reviews top_award_reviews_reviewer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_reviews
    ADD CONSTRAINT top_award_reviews_reviewer_user_id_fkey FOREIGN KEY (reviewer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: top_award_service_logs top_award_service_logs_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_service_logs
    ADD CONSTRAINT top_award_service_logs_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: top_award_service_logs top_award_service_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_service_logs
    ADD CONSTRAINT top_award_service_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: top_award_service_logs top_award_service_logs_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_service_logs
    ADD CONSTRAINT top_award_service_logs_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: top_award_service_logs top_award_service_logs_participant_top_award_progress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_award_service_logs
    ADD CONSTRAINT top_award_service_logs_participant_top_award_progress_id_fkey FOREIGN KEY (participant_top_award_progress_id) REFERENCES public.participant_top_award_progress(id) ON DELETE CASCADE;


--
-- Name: top_awards top_awards_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.top_awards
    ADD CONSTRAINT top_awards_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: trusted_devices trusted_devices_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: trusted_devices trusted_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: two_factor_codes two_factor_codes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factor_codes
    ADD CONSTRAINT two_factor_codes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: two_factor_codes two_factor_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factor_codes
    ADD CONSTRAINT two_factor_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_organizations user_organizations_last_active_scout_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_last_active_scout_year_id_fkey FOREIGN KEY (last_active_scout_year_id) REFERENCES public.scout_years(id);


--
-- Name: user_organizations user_organizations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_organizations user_organizations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_participants user_participants_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_participants
    ADD CONSTRAINT user_participants_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: user_participants user_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_participants
    ADD CONSTRAINT user_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: whatsapp_baileys_connections whatsapp_baileys_connections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_baileys_connections
    ADD CONSTRAINT whatsapp_baileys_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: year_plan_meeting_activities year_plan_meeting_activities_activity_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meeting_activities
    ADD CONSTRAINT year_plan_meeting_activities_activity_library_id_fkey FOREIGN KEY (activity_library_id) REFERENCES public.activity_library(id) ON DELETE SET NULL;


--
-- Name: year_plan_meeting_activities year_plan_meeting_activities_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meeting_activities
    ADD CONSTRAINT year_plan_meeting_activities_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.year_plan_meetings(id) ON DELETE CASCADE;


--
-- Name: year_plan_meeting_activities year_plan_meeting_activities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meeting_activities
    ADD CONSTRAINT year_plan_meeting_activities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: year_plan_meetings year_plan_meetings_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings
    ADD CONSTRAINT year_plan_meetings_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;


--
-- Name: year_plan_meetings year_plan_meetings_animateur_responsable_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings
    ADD CONSTRAINT year_plan_meetings_animateur_responsable_fkey FOREIGN KEY (animateur_responsable) REFERENCES public.users(id);


--
-- Name: year_plan_meetings year_plan_meetings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings
    ADD CONSTRAINT year_plan_meetings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: year_plan_meetings year_plan_meetings_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings
    ADD CONSTRAINT year_plan_meetings_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.year_plan_periods(id) ON DELETE SET NULL;


--
-- Name: year_plan_meetings year_plan_meetings_reunion_preparation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings
    ADD CONSTRAINT year_plan_meetings_reunion_preparation_id_fkey FOREIGN KEY (reunion_preparation_id) REFERENCES public.reunion_preparations(id) ON DELETE SET NULL;


--
-- Name: year_plan_meetings year_plan_meetings_year_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_meetings
    ADD CONSTRAINT year_plan_meetings_year_plan_id_fkey FOREIGN KEY (year_plan_id) REFERENCES public.year_plans(id) ON DELETE CASCADE;


--
-- Name: year_plan_objectives year_plan_objectives_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_objectives
    ADD CONSTRAINT year_plan_objectives_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: year_plan_objectives year_plan_objectives_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_objectives
    ADD CONSTRAINT year_plan_objectives_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.year_plan_objectives(id) ON DELETE CASCADE;


--
-- Name: year_plan_objectives year_plan_objectives_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_objectives
    ADD CONSTRAINT year_plan_objectives_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.year_plan_periods(id) ON DELETE SET NULL;


--
-- Name: year_plan_objectives year_plan_objectives_year_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_objectives
    ADD CONSTRAINT year_plan_objectives_year_plan_id_fkey FOREIGN KEY (year_plan_id) REFERENCES public.year_plans(id) ON DELETE CASCADE;


--
-- Name: year_plan_periods year_plan_periods_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_periods
    ADD CONSTRAINT year_plan_periods_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: year_plan_periods year_plan_periods_year_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_periods
    ADD CONSTRAINT year_plan_periods_year_plan_id_fkey FOREIGN KEY (year_plan_id) REFERENCES public.year_plans(id) ON DELETE CASCADE;


--
-- Name: year_plan_reminders year_plan_reminders_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_reminders
    ADD CONSTRAINT year_plan_reminders_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.year_plan_meetings(id) ON DELETE CASCADE;


--
-- Name: year_plan_reminders year_plan_reminders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plan_reminders
    ADD CONSTRAINT year_plan_reminders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: year_plans year_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plans
    ADD CONSTRAINT year_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: year_plans year_plans_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.year_plans
    ADD CONSTRAINT year_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict gJjnYqQhHIoLpimte7cmxRu8e7oe8dxT2yjqPbaDadautsPtsV0vlWO6li8akVb

