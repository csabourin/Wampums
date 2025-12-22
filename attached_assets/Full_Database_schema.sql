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
CREATE TABLE public.activities (
  id integer NOT NULL DEFAULT nextval('activities_id_seq'::regclass),
  organization_id integer NOT NULL,
  created_by uuid NOT NULL,
  name character varying NOT NULL,
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
  CONSTRAINT activities_pkey PRIMARY KEY (id),
  CONSTRAINT activities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE public.announcement_logs (
  id integer NOT NULL DEFAULT nextval('announcement_logs_id_seq'::regclass),
  announcement_id integer,
  channel character varying NOT NULL,
  recipient_email text,
  recipient_user_id uuid,
  status character varying NOT NULL,
  error_message text,
  metadata jsonb,
  sent_at timestamp with time zone DEFAULT now(),
  CONSTRAINT announcement_logs_pkey PRIMARY KEY (id),
  CONSTRAINT announcement_logs_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id)
);
CREATE TABLE public.announcements (
  id integer NOT NULL DEFAULT nextval('announcements_id_seq'::regclass),
  organization_id integer NOT NULL,
  created_by uuid NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  recipient_roles ARRAY NOT NULL DEFAULT '{}'::text[],
  recipient_groups ARRAY DEFAULT '{}'::integer[],
  scheduled_at timestamp with time zone,
  sent_at timestamp with time zone,
  status character varying NOT NULL DEFAULT 'draft'::character varying,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT announcements_pkey PRIMARY KEY (id),
  CONSTRAINT announcements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
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
  etoiles integer DEFAULT 1,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  status character varying DEFAULT 'pending'::character varying,
  approval_date timestamp without time zone,
  organization_id integer,
  badge_template_id integer NOT NULL,
  section character varying NOT NULL,
  CONSTRAINT badge_progress_pkey PRIMARY KEY (id),
  CONSTRAINT badge_progress_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT badge_progress_badge_template_id_fkey FOREIGN KEY (badge_template_id) REFERENCES public.badge_templates(id)
);
CREATE TABLE public.badge_templates (
  id integer NOT NULL DEFAULT nextval('badge_templates_id_seq'::regclass),
  organization_id integer NOT NULL,
  template_key character varying NOT NULL,
  name character varying NOT NULL,
  translation_key character varying,
  section character varying NOT NULL DEFAULT 'general'::character varying,
  level_count integer NOT NULL DEFAULT 3,
  levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT badge_templates_pkey PRIMARY KEY (id),
  CONSTRAINT badge_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.budget_categories (
  id integer NOT NULL DEFAULT nextval('budget_categories_id_seq'::regclass),
  organization_id integer NOT NULL,
  name character varying NOT NULL,
  description text,
  category_type character varying DEFAULT 'other'::character varying CHECK (category_type::text = ANY (ARRAY['registration'::character varying, 'fundraising'::character varying, 'activity'::character varying, 'operations'::character varying, 'other'::character varying]::text[])),
  display_order integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT budget_categories_pkey PRIMARY KEY (id),
  CONSTRAINT budget_categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.budget_expenses (
  id integer NOT NULL DEFAULT nextval('budget_expenses_id_seq'::regclass),
  organization_id integer NOT NULL,
  budget_category_id integer,
  budget_item_id integer,
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  expense_date date NOT NULL,
  description text NOT NULL,
  payment_method character varying,
  reference_number character varying,
  receipt_url text,
  notes text,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT budget_expenses_pkey PRIMARY KEY (id),
  CONSTRAINT budget_expenses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT budget_expenses_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id),
  CONSTRAINT budget_expenses_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items(id),
  CONSTRAINT budget_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE public.budget_items (
  id integer NOT NULL DEFAULT nextval('budget_items_id_seq'::regclass),
  organization_id integer NOT NULL,
  budget_category_id integer NOT NULL,
  name character varying NOT NULL,
  description text,
  item_type character varying DEFAULT 'other'::character varying CHECK (item_type::text = ANY (ARRAY['revenue'::character varying, 'expense'::character varying, 'both'::character varying]::text[])),
  unit_price numeric,
  estimated_quantity integer,
  display_order integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT budget_items_pkey PRIMARY KEY (id),
  CONSTRAINT budget_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT budget_items_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id)
);
CREATE TABLE public.budget_plans (
  id integer NOT NULL DEFAULT nextval('budget_plans_id_seq'::regclass),
  organization_id integer NOT NULL,
  budget_item_id integer,
  fiscal_year_start date NOT NULL,
  fiscal_year_end date NOT NULL,
  budgeted_revenue numeric DEFAULT 0,
  budgeted_expense numeric DEFAULT 0,
  notes text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT budget_plans_pkey PRIMARY KEY (id),
  CONSTRAINT budget_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT budget_plans_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items(id)
);
CREATE TABLE public.budget_revenues (
  id integer NOT NULL DEFAULT nextval('budget_revenues_id_seq'::regclass),
  organization_id integer NOT NULL,
  budget_category_id integer,
  budget_item_id integer,
  revenue_type character varying DEFAULT 'other'::character varying,
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  revenue_date date NOT NULL,
  description text NOT NULL,
  payment_method character varying,
  reference_number character varying,
  receipt_url text,
  notes text,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT budget_revenues_pkey PRIMARY KEY (id),
  CONSTRAINT budget_revenues_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT budget_revenues_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id),
  CONSTRAINT budget_revenues_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items(id),
  CONSTRAINT budget_revenues_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE public.carpool_assignments (
  id integer NOT NULL DEFAULT nextval('carpool_assignments_id_seq'::regclass),
  carpool_offer_id integer NOT NULL,
  participant_id integer NOT NULL,
  assigned_by uuid NOT NULL,
  organization_id integer NOT NULL,
  trip_direction character varying NOT NULL CHECK (trip_direction::text = ANY (ARRAY['both'::character varying, 'to_activity'::character varying, 'from_activity'::character varying]::text[])),
  notes text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT carpool_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT carpool_assignments_carpool_offer_id_fkey FOREIGN KEY (carpool_offer_id) REFERENCES public.carpool_offers(id),
  CONSTRAINT carpool_assignments_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT carpool_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id),
  CONSTRAINT carpool_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.carpool_offers (
  id integer NOT NULL DEFAULT nextval('carpool_offers_id_seq'::regclass),
  activity_id integer NOT NULL,
  user_id uuid NOT NULL,
  organization_id integer NOT NULL,
  vehicle_make character varying NOT NULL,
  vehicle_color character varying NOT NULL,
  total_seats_available integer NOT NULL CHECK (total_seats_available > 0 AND total_seats_available <= 8),
  trip_direction character varying NOT NULL CHECK (trip_direction::text = ANY (ARRAY['both'::character varying, 'to_activity'::character varying, 'from_activity'::character varying]::text[])),
  notes text,
  is_active boolean DEFAULT true,
  cancelled_at timestamp with time zone,
  cancelled_reason text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT carpool_offers_pkey PRIMARY KEY (id),
  CONSTRAINT carpool_offers_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id),
  CONSTRAINT carpool_offers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT carpool_offers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.equipment_item_organizations (
  equipment_id integer NOT NULL,
  organization_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT equipment_item_organizations_pkey PRIMARY KEY (equipment_id, organization_id),
  CONSTRAINT equipment_item_organizations_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_items(id),
  CONSTRAINT equipment_item_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.equipment_items (
  id integer NOT NULL DEFAULT nextval('equipment_items_id_seq'::regclass),
  organization_id integer NOT NULL,
  name character varying NOT NULL,
  category character varying,
  description text,
  quantity_total integer NOT NULL DEFAULT 1 CHECK (quantity_total >= 0),
  quantity_available integer NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  condition_note text,
  is_active boolean DEFAULT true,
  attributes jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  acquisition_date date DEFAULT now(),
  item_value numeric,
  photo_url text,
  location_type character varying NOT NULL DEFAULT 'local_scout_hall'::character varying CHECK (location_type::text = ANY (ARRAY['local_scout_hall'::character varying, 'warehouse'::character varying, 'leader_home'::character varying, 'other'::character varying]::text[])),
  location_details character varying DEFAULT ''::character varying,
  CONSTRAINT equipment_items_pkey PRIMARY KEY (id),
  CONSTRAINT equipment_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.equipment_reservations (
  id integer NOT NULL DEFAULT nextval('equipment_reservations_id_seq'::regclass),
  organization_id integer NOT NULL,
  equipment_id integer NOT NULL,
  meeting_id integer,
  meeting_date date NOT NULL,
  reserved_quantity integer NOT NULL DEFAULT 1 CHECK (reserved_quantity > 0),
  reserved_for character varying NOT NULL DEFAULT ''::character varying,
  status character varying DEFAULT 'reserved'::character varying CHECK (status::text = ANY (ARRAY['reserved'::character varying, 'confirmed'::character varying, 'returned'::character varying, 'cancelled'::character varying]::text[])),
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  date_from date,
  date_to date,
  CONSTRAINT equipment_reservations_pkey PRIMARY KEY (id),
  CONSTRAINT equipment_reservations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT equipment_reservations_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_items(id),
  CONSTRAINT equipment_reservations_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.reunion_preparations(id),
  CONSTRAINT equipment_reservations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE public.fee_definitions (
  id integer NOT NULL DEFAULT nextval('fee_definitions_id_seq'::regclass),
  organization_id integer NOT NULL,
  registration_fee numeric NOT NULL,
  membership_fee numeric NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  year_start date NOT NULL,
  year_end date NOT NULL,
  budget_category_id integer,
  CONSTRAINT fee_definitions_pkey PRIMARY KEY (id),
  CONSTRAINT fee_definitions_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id),
  CONSTRAINT fee_definitions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
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
CREATE TABLE public.fundraiser_entries (
  participant_id integer,
  amount integer NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  amount_paid double precision DEFAULT '0'::double precision,
  fundraiser integer,
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL UNIQUE,
  CONSTRAINT fundraiser_entries_pkey PRIMARY KEY (id),
  CONSTRAINT fundraiser_entries_fundraiser_fkey FOREIGN KEY (fundraiser) REFERENCES public.fundraisers(id),
  CONSTRAINT fundraiser_entries_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id)
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
  budget_category_id integer,
  CONSTRAINT fundraisers_pkey PRIMARY KEY (id),
  CONSTRAINT fundraisers_budget_category_id_fkey FOREIGN KEY (budget_category_id) REFERENCES public.budget_categories(id),
  CONSTRAINT fundraisers_organization_fkey FOREIGN KEY (organization) REFERENCES public.organizations(id)
);
CREATE TABLE public.google_chat_config (
  id integer NOT NULL DEFAULT nextval('google_chat_config_id_seq'::regclass),
  organization_id integer NOT NULL,
  service_account_email character varying NOT NULL,
  credentials_json jsonb NOT NULL,
  project_id character varying,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT google_chat_config_pkey PRIMARY KEY (id),
  CONSTRAINT google_chat_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.google_chat_messages (
  id integer NOT NULL DEFAULT nextval('google_chat_messages_id_seq'::regclass),
  organization_id integer NOT NULL,
  space_id character varying NOT NULL,
  message_id character varying,
  subject character varying,
  message_text text NOT NULL,
  sent_by_user_id uuid,
  sent_at timestamp without time zone DEFAULT now(),
  delivery_status character varying DEFAULT 'sent'::character varying,
  error_message text,
  CONSTRAINT google_chat_messages_pkey PRIMARY KEY (id),
  CONSTRAINT google_chat_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT google_chat_messages_sent_by_user_id_fkey FOREIGN KEY (sent_by_user_id) REFERENCES public.users(id)
);
CREATE TABLE public.google_chat_spaces (
  id integer NOT NULL DEFAULT nextval('google_chat_spaces_id_seq'::regclass),
  organization_id integer NOT NULL,
  space_id character varying NOT NULL UNIQUE,
  space_name character varying,
  space_type character varying DEFAULT 'SPACE'::character varying,
  is_broadcast_space boolean DEFAULT false,
  is_active boolean DEFAULT true,
  member_count integer,
  description text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT google_chat_spaces_pkey PRIMARY KEY (id),
  CONSTRAINT google_chat_spaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.groups (
  id integer NOT NULL DEFAULT nextval('groups_id_seq'::regclass),
  name character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  organization_id integer,
  section character varying DEFAULT 'general'::character varying,
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
CREATE TABLE public.local_groups (
  id integer NOT NULL DEFAULT nextval('local_groups_id_seq'::regclass),
  name character varying NOT NULL,
  slug character varying NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT local_groups_pkey PRIMARY KEY (id)
);
CREATE TABLE public.medication_distributions (
  id integer NOT NULL DEFAULT nextval('medication_distributions_id_seq'::regclass),
  organization_id integer NOT NULL,
  medication_requirement_id integer NOT NULL,
  participant_id integer NOT NULL,
  participant_medication_id integer,
  scheduled_for timestamp with time zone NOT NULL,
  activity_name character varying,
  dose_amount numeric,
  dose_unit character varying,
  dose_notes text,
  general_notice text,
  status character varying NOT NULL DEFAULT 'scheduled'::character varying CHECK (status::text = ANY (ARRAY['scheduled'::character varying, 'given'::character varying, 'missed'::character varying, 'cancelled'::character varying]::text[])),
  administered_at timestamp with time zone,
  administered_by uuid,
  witness_name character varying,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT medication_distributions_pkey PRIMARY KEY (id),
  CONSTRAINT medication_distributions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT medication_distributions_medication_requirement_id_fkey FOREIGN KEY (medication_requirement_id) REFERENCES public.medication_requirements(id),
  CONSTRAINT medication_distributions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT medication_distributions_participant_medication_id_fkey FOREIGN KEY (participant_medication_id) REFERENCES public.participant_medications(id),
  CONSTRAINT medication_distributions_administered_by_fkey FOREIGN KEY (administered_by) REFERENCES public.users(id)
);
CREATE TABLE public.medication_requirements (
  id integer NOT NULL DEFAULT nextval('medication_requirements_id_seq'::regclass),
  organization_id integer NOT NULL,
  medication_name character varying NOT NULL,
  dosage_instructions text,
  frequency_text character varying,
  route character varying,
  default_dose_amount numeric,
  default_dose_unit character varying,
  general_notes text,
  start_date date,
  end_date date,
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  frequency_preset_type character varying,
  frequency_times jsonb,
  frequency_slots jsonb,
  frequency_interval_hours integer,
  frequency_interval_start time without time zone,
  CONSTRAINT medication_requirements_pkey PRIMARY KEY (id),
  CONSTRAINT medication_requirements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT medication_requirements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
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
CREATE TABLE public.organization_local_groups (
  organization_id integer NOT NULL,
  local_group_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organization_local_groups_pkey PRIMARY KEY (organization_id, local_group_id),
  CONSTRAINT organization_local_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT organization_local_groups_local_group_id_fkey FOREIGN KEY (local_group_id) REFERENCES public.local_groups(id)
);
CREATE TABLE public.organization_program_sections (
  organization_id integer NOT NULL,
  section_key text NOT NULL CHECK (length(btrim(section_key)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT organization_program_sections_pkey PRIMARY KEY (organization_id, section_key),
  CONSTRAINT organization_program_sections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
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
  program_section text NOT NULL DEFAULT 'general'::text,
  CONSTRAINT organizations_pkey PRIMARY KEY (id),
  CONSTRAINT organizations_program_section_fk FOREIGN KEY (id) REFERENCES public.organization_program_sections(organization_id),
  CONSTRAINT organizations_program_section_fk FOREIGN KEY (program_section) REFERENCES public.organization_program_sections(organization_id),
  CONSTRAINT organizations_program_section_fk FOREIGN KEY (id) REFERENCES public.organization_program_sections(section_key),
  CONSTRAINT organizations_program_section_fk FOREIGN KEY (program_section) REFERENCES public.organization_program_sections(section_key)
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
CREATE TABLE public.participant_fees (
  id integer NOT NULL DEFAULT nextval('participant_fees_id_seq'::regclass),
  participant_id integer NOT NULL,
  organization_id integer NOT NULL,
  fee_definition_id integer NOT NULL,
  total_registration_fee numeric NOT NULL,
  total_membership_fee numeric NOT NULL,
  total_amount numeric DEFAULT (total_registration_fee + total_membership_fee),
  status character varying DEFAULT 'unpaid'::character varying,
  notes text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT participant_fees_pkey PRIMARY KEY (id),
  CONSTRAINT participant_fees_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT participant_fees_fee_definition_id_fkey FOREIGN KEY (fee_definition_id) REFERENCES public.fee_definitions(id),
  CONSTRAINT participant_fees_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.participant_groups (
  participant_id integer NOT NULL,
  group_id integer,
  organization_id integer NOT NULL,
  first_leader boolean NOT NULL DEFAULT false,
  second_leader boolean NOT NULL DEFAULT false,
  roles text,
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
CREATE TABLE public.participant_medications (
  id integer NOT NULL DEFAULT nextval('participant_medications_id_seq'::regclass),
  organization_id integer NOT NULL,
  medication_requirement_id integer NOT NULL,
  participant_id integer NOT NULL,
  participant_notes text,
  custom_dosage text,
  custom_frequency text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT participant_medications_pkey PRIMARY KEY (id),
  CONSTRAINT participant_medications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT participant_medications_medication_requirement_id_fkey FOREIGN KEY (medication_requirement_id) REFERENCES public.medication_requirements(id),
  CONSTRAINT participant_medications_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id)
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
CREATE TABLE public.payment_plans (
  id integer NOT NULL DEFAULT nextval('payment_plans_id_seq'::regclass),
  participant_fee_id integer NOT NULL,
  number_of_payments integer NOT NULL,
  amount_per_payment numeric NOT NULL,
  start_date date NOT NULL,
  frequency character varying NOT NULL,
  notes text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT payment_plans_pkey PRIMARY KEY (id),
  CONSTRAINT payment_plans_participant_fee_id_fkey FOREIGN KEY (participant_fee_id) REFERENCES public.participant_fees(id)
);
CREATE TABLE public.payments (
  id integer NOT NULL DEFAULT nextval('payments_id_seq'::regclass),
  participant_fee_id integer NOT NULL,
  payment_plan_id integer,
  amount numeric NOT NULL,
  payment_date date NOT NULL,
  method character varying,
  reference_number character varying,
  created_at timestamp without time zone DEFAULT now(),
  stripe_payment_intent_id character varying,
  stripe_payment_method_id character varying,
  stripe_transaction_id character varying,
  stripe_payment_status character varying,
  stripe_metadata jsonb DEFAULT '{}'::jsonb,
  payment_processor character varying DEFAULT 'manual'::character varying,
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_participant_fee_id_fkey FOREIGN KEY (participant_fee_id) REFERENCES public.participant_fees(id),
  CONSTRAINT payments_payment_plan_id_fkey FOREIGN KEY (payment_plan_id) REFERENCES public.payment_plans(id)
);
CREATE TABLE public.permission_slips (
  id integer NOT NULL DEFAULT nextval('permission_slips_id_seq'::regclass),
  organization_id integer NOT NULL,
  participant_id integer NOT NULL,
  guardian_id integer,
  meeting_id integer,
  meeting_date date NOT NULL,
  status character varying DEFAULT 'pending'::character varying CHECK (status::text = ANY (ARRAY['pending'::character varying, 'signed'::character varying, 'revoked'::character varying, 'expired'::character varying]::text[])),
  consent_payload jsonb DEFAULT '{}'::jsonb,
  signed_at timestamp with time zone,
  signed_by text,
  signature_hash text,
  contact_confirmation jsonb,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  activity_title character varying,
  activity_description text,
  deadline_date timestamp with time zone,
  email_sent boolean DEFAULT false,
  email_sent_at timestamp with time zone,
  reminder_sent boolean DEFAULT false,
  reminder_sent_at timestamp with time zone,
  CONSTRAINT permission_slips_pkey PRIMARY KEY (id),
  CONSTRAINT permission_slips_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT permission_slips_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id),
  CONSTRAINT permission_slips_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id),
  CONSTRAINT permission_slips_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.reunion_preparations(id)
);
CREATE TABLE public.permissions (
  id integer NOT NULL DEFAULT nextval('permissions_id_seq'::regclass),
  permission_key character varying NOT NULL UNIQUE,
  permission_name character varying NOT NULL,
  category character varying NOT NULL,
  description text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT permissions_pkey PRIMARY KEY (id)
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
  youth_of_honor text,
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
CREATE TABLE public.role_permissions (
  role_id integer NOT NULL,
  permission_id integer NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id),
  CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id)
);
CREATE TABLE public.roles (
  id integer NOT NULL DEFAULT nextval('roles_id_seq'::regclass),
  role_name character varying NOT NULL UNIQUE,
  display_name character varying NOT NULL,
  description text,
  is_system_role boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT roles_pkey PRIMARY KEY (id)
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
CREATE TABLE public.trusted_devices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id integer NOT NULL,
  device_token character varying NOT NULL UNIQUE,
  device_name text,
  device_fingerprint character varying,
  last_used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp with time zone NOT NULL,
  is_active boolean DEFAULT true,
  CONSTRAINT trusted_devices_pkey PRIMARY KEY (id),
  CONSTRAINT trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT trusted_devices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.two_factor_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id integer NOT NULL,
  code character varying NOT NULL,
  code_hash character varying NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  attempts integer DEFAULT 0,
  verified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  ip_address character varying,
  user_agent text,
  CONSTRAINT two_factor_codes_pkey PRIMARY KEY (id),
  CONSTRAINT two_factor_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT two_factor_codes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.user_organizations (
  id integer NOT NULL DEFAULT nextval('user_organizations_id_seq'::regclass),
  organization_id integer NOT NULL,
  role character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  user_id uuid,
  role_ids jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT user_organizations_pkey PRIMARY KEY (id),
  CONSTRAINT user_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT user_organizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.user_organizations_backup (
  id integer,
  organization_id integer,
  role character varying,
  created_at timestamp without time zone,
  user_id uuid
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
  verification_token character varying UNIQUE,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  role text,
  full_name character varying,
  reset_token character varying,
  reset_token_expiry timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  supabase_user_id uuid,
  token_version integer DEFAULT 0,
  language_preference character varying,
  whatsapp_phone_number character varying,
  CONSTRAINT users_pkey PRIMARY KEY (id, email)
);
CREATE TABLE public.whatsapp_baileys_connections (
  id integer NOT NULL DEFAULT nextval('whatsapp_baileys_connections_id_seq'::regclass),
  organization_id integer NOT NULL UNIQUE,
  is_connected boolean DEFAULT false,
  connected_phone_number character varying,
  session_data text,
  last_connected_at timestamp without time zone,
  last_disconnected_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  auth_creds jsonb DEFAULT '{}'::jsonb,
  auth_keys jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT whatsapp_baileys_connections_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_baileys_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);