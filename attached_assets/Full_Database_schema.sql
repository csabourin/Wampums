-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.activites_rencontre (
  id bigint NOT NULL,
  activity text NOT NULL,
  type text NOT NULL,
  estimated_time_min integer NOT NULL,
  estimated_time_max integer NOT NULL,
  material text,
  description text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT activites_rencontre_pkey PRIMARY KEY (id)
);
CREATE TABLE public.attendance (
  id integer NOT NULL DEFAULT nextval('attendance_id_seq'::regclass),
  participant_id integer NOT NULL,
  date date NOT NULL,
  status character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  point_adjustment integer DEFAULT 0,
  organization_id integer,
  CONSTRAINT attendance_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT attendance_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.badge_progress (
  id integer NOT NULL DEFAULT nextval('badge_progress_id_seq'::regclass),
  participant_id integer,
  territoire_chasse character varying NOT NULL,
  objectif text,
  description text,
  fierte boolean,
  raison text,
  date_obtention date,
  etoiles integer DEFAULT 0,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  status character varying DEFAULT 'pending'::character varying,
  approval_date timestamp without time zone,
  organization_id integer,
  CONSTRAINT badge_progress_pkey PRIMARY KEY (id),
  CONSTRAINT badge_progress_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.calendars (
  participant_id integer,
  amount integer NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  amount_paid double precision DEFAULT '0'::double precision,
  fundraiser integer,
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL UNIQUE,
  CONSTRAINT calendars_pkey PRIMARY KEY (id),
  CONSTRAINT calendars_fundraiser_fkey FOREIGN KEY (fundraiser) REFERENCES public.fundraisers(id),
  CONSTRAINT calendars_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id)
);
CREATE TABLE public.form_submissions (
  id integer NOT NULL DEFAULT nextval('form_submissions_id_seq'::regclass),
  organization_id integer NOT NULL,
  participant_id integer,
  form_type character varying NOT NULL,
  submission_data jsonb NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  user_id uuid,
  CONSTRAINT form_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT form_submissions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT form_submissions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT form_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.fundraisers (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text,
  start_date date,
  end_date date,
  objective numeric,
  result numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  organization integer,
  archived boolean NOT NULL DEFAULT false,
  CONSTRAINT fundraisers_pkey PRIMARY KEY (id),
  CONSTRAINT fundraisers_organization_fkey FOREIGN KEY (organization) REFERENCES public.organizations(id)
);
CREATE TABLE public.groups (
  id integer NOT NULL DEFAULT nextval('groups_id_seq'::regclass),
  name character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  organization_id integer,
  CONSTRAINT groups_pkey PRIMARY KEY (id),
  CONSTRAINT groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.guardian_users (
  guardian_id integer NOT NULL,
  user_id uuid,
  CONSTRAINT guardian_users_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id),
  CONSTRAINT guardian_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.guests (
  id integer NOT NULL DEFAULT nextval('guests_id_seq'::regclass),
  name character varying NOT NULL,
  email character varying,
  attendance_date date NOT NULL,
  organization_id integer,
  CONSTRAINT guests_pkey PRIMARY KEY (id),
  CONSTRAINT guests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.honors (
  id integer NOT NULL DEFAULT nextval('honors_id_seq'::regclass),
  participant_id integer NOT NULL,
  date date NOT NULL,
  organization_id integer,
  reason text,
  CONSTRAINT honors_pkey PRIMARY KEY (id),
  CONSTRAINT honors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT honors_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id)
);
CREATE TABLE public.languages (
  id integer NOT NULL DEFAULT nextval('languages_id_seq'::regclass),
  code character varying NOT NULL,
  name character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT languages_pkey PRIMARY KEY (id)
);
CREATE TABLE public.names (
  id integer NOT NULL DEFAULT nextval('names_id_seq'::regclass),
  first_name character varying NOT NULL,
  group_id integer,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  participant_id integer,
  CONSTRAINT names_pkey PRIMARY KEY (id)
);
CREATE TABLE public.news (
  id integer NOT NULL DEFAULT nextval('news_id_seq'::regclass),
  title character varying NOT NULL,
  content text NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  organization_id integer,
  expires date,
  link text,
  CONSTRAINT news_pkey PRIMARY KEY (id),
  CONSTRAINT news_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.organization_domains (
  id integer NOT NULL DEFAULT nextval('organization_domains_id_seq'::regclass),
  organization_id integer,
  domain character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_domains_pkey PRIMARY KEY (id),
  CONSTRAINT organization_domains_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.organization_form_formats (
  id integer NOT NULL DEFAULT nextval('organization_form_formats_id_seq'::regclass),
  organization_id integer NOT NULL,
  form_type character varying NOT NULL,
  form_structure jsonb NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  display_type text,
  CONSTRAINT organization_form_formats_pkey PRIMARY KEY (id),
  CONSTRAINT organization_form_formats_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.organization_settings (
  id integer NOT NULL DEFAULT nextval('organization_settings_id_seq'::regclass),
  organization_id integer,
  setting_key character varying NOT NULL,
  setting_value jsonb,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_settings_pkey PRIMARY KEY (id),
  CONSTRAINT organization_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.organizations (
  id integer NOT NULL DEFAULT nextval('organizations_id_seq'::regclass),
  name character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  api_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.parents_guardians (
  id integer NOT NULL DEFAULT nextval('guardians_id_seq'::regclass),
  nom character varying NOT NULL,
  prenom character varying NOT NULL,
  old_lien text,
  courriel character varying,
  telephone_residence character varying,
  telephone_travail character varying,
  telephone_cellulaire character varying,
  is_primary boolean,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  is_emergency_contact boolean,
  user_uuid uuid,
  CONSTRAINT parents_guardians_pkey PRIMARY KEY (id)
);
CREATE TABLE public.participant_groups (
  participant_id integer NOT NULL,
  group_id integer,
  organization_id integer NOT NULL,
  is_leader boolean NOT NULL DEFAULT false,
  is_second_leader boolean NOT NULL DEFAULT false,
  CONSTRAINT participant_groups_pkey PRIMARY KEY (participant_id, organization_id),
  CONSTRAINT participant_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT participant_groups_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT participant_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id)
);
CREATE TABLE public.participant_guardians (
  guardian_id integer NOT NULL,
  participant_id integer NOT NULL,
  lien character varying,
  CONSTRAINT participant_guardians_pkey PRIMARY KEY (guardian_id, participant_id),
  CONSTRAINT participant_guardians_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT participant_guardians_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id)
);
CREATE TABLE public.participant_organizations (
  participant_id integer NOT NULL,
  organization_id integer NOT NULL,
  inscription_date date,
  CONSTRAINT participant_organizations_pkey PRIMARY KEY (participant_id, organization_id),
  CONSTRAINT participant_organizations_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT participant_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.participants (
  id integer NOT NULL DEFAULT nextval('new_participants_id_seq'::regclass),
  first_name character varying NOT NULL,
  last_name character varying NOT NULL,
  date_naissance date,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT participants_pkey PRIMARY KEY (id)
);
CREATE TABLE public.points (
  id integer NOT NULL DEFAULT nextval('points_id_seq'::regclass),
  participant_id integer,
  group_id integer,
  value integer NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  organization_id integer,
  CONSTRAINT points_pkey PRIMARY KEY (id),
  CONSTRAINT points_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT points_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id)
);
CREATE TABLE public.processed_transactions (
  id integer NOT NULL DEFAULT nextval('processed_transactions_id_seq'::regclass),
  transaction_id character varying NOT NULL,
  processed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT processed_transactions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.profile (
  email text NOT NULL UNIQUE,
  password character varying NOT NULL,
  is_verified boolean DEFAULT false,
  verification_token character varying,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  role text,
  full_name character varying,
  reset_token character varying,
  reset_token_expiry timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  supabase_user_id uuid,
  token_version integer DEFAULT 0,
  CONSTRAINT profile_pkey PRIMARY KEY (id, email)
);
CREATE TABLE public.profiles (
  email text NOT NULL UNIQUE,
  password character varying NOT NULL,
  is_verified boolean DEFAULT false,
  verification_token character varying,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  role text,
  full_name character varying,
  reset_token character varying,
  reset_token_expiry timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  auth_user_id uuid NOT NULL,
  token_version integer DEFAULT 0,
  CONSTRAINT profiles_pkey PRIMARY KEY (id, email),
  CONSTRAINT profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.rappel_reunion (
  id integer NOT NULL DEFAULT nextval('rappel_reunion_id_seq'::regclass),
  creation_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  reminder_date date NOT NULL,
  organization_id integer NOT NULL,
  is_recurring boolean DEFAULT false,
  reminder_text text NOT NULL,
  CONSTRAINT rappel_reunion_pkey PRIMARY KEY (id),
  CONSTRAINT rappel_reunion_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.reunion_preparations (
  id integer NOT NULL DEFAULT nextval('reunion_preparations_id_seq'::regclass),
  organization_id integer NOT NULL,
  date date NOT NULL,
  louveteau_dhonneur text,
  endroit text NOT NULL,
  activities jsonb NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  animateur_responsable uuid,
  CONSTRAINT reunion_preparations_pkey PRIMARY KEY (id),
  CONSTRAINT reunion_preparations_animateur_responsable_fkey FOREIGN KEY (animateur_responsable) REFERENCES public.users(id),
  CONSTRAINT reunion_preparations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.subscribers (
  id integer NOT NULL DEFAULT nextval('subscribers_id_seq'::regclass),
  endpoint text NOT NULL UNIQUE,
  expiration_time timestamp without time zone,
  p256dh text,
  auth text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  organization_id integer,
  user_id uuid,
  CONSTRAINT subscribers_pkey PRIMARY KEY (id),
  CONSTRAINT subscribers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT subscribers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.sync_log (
  id integer NOT NULL DEFAULT nextval('sync_log_id_seq'::regclass),
  action character varying NOT NULL,
  data jsonb NOT NULL,
  timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  synced boolean DEFAULT false,
  CONSTRAINT sync_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.translations (
  id integer NOT NULL DEFAULT nextval('translations_id_seq'::regclass),
  language_id integer,
  key character varying NOT NULL,
  value text NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT translations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_organizations (
  id integer NOT NULL DEFAULT nextval('user_organizations_id_seq'::regclass),
  organization_id integer NOT NULL,
  role character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  user_id uuid,
  CONSTRAINT user_organizations_pkey PRIMARY KEY (id),
  CONSTRAINT user_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT user_organizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.user_participants (
  participant_id integer NOT NULL,
  user_id uuid NOT NULL,
  CONSTRAINT user_participants_pkey PRIMARY KEY (participant_id, user_id),
  CONSTRAINT user_participants_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT user_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.users (
  email text NOT NULL UNIQUE,
  password character varying NOT NULL,
  is_verified boolean DEFAULT false,
  verification_token character varying,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  role text,
  full_name character varying,
  reset_token character varying,
  reset_token_expiry timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  supabase_user_id uuid,
  token_version integer DEFAULT 0,
  CONSTRAINT users_pkey PRIMARY KEY (id, email)
);