-- Migration: Create incident reports tables
-- Adds incident_reports, incident_escalation_contacts, and incident_email_queue tables
-- Also seeds incidents.view and incidents.manage permissions

-- ============================================================
-- Table 1: incident_reports
-- Metadata wrapper around form_submissions for incident-specific tracking
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS incident_reports_id_seq;

CREATE TABLE IF NOT EXISTS public.incident_reports (
  id integer NOT NULL DEFAULT nextval('incident_reports_id_seq'::regclass),
  organization_id integer NOT NULL,

  -- Link to the formBuilder submission (submission_data JSONB lives there)
  form_submission_id integer,

  -- Workflow status: draft or submitted
  status character varying NOT NULL DEFAULT 'draft'::character varying
    CHECK (status::text = ANY (ARRAY['draft'::character varying, 'submitted'::character varying]::text[])),

  -- Victim identification
  victim_type character varying NOT NULL DEFAULT 'participant'::character varying
    CHECK (victim_type::text = ANY (ARRAY['participant'::character varying, 'leader'::character varying, 'parent'::character varying, 'other'::character varying]::text[])),
  victim_participant_id integer,
  victim_user_id uuid,
  victim_name character varying,

  -- Activity link (optional)
  activity_id integer,

  -- Denormalized summary fields for list views (avoid JSONB extraction on list queries)
  incident_date date,
  incident_time time without time zone,
  incident_location text,

  -- Escalation tracking
  escalation_sent_at timestamp with time zone,
  escalation_sent_to text[],

  -- Authoring
  created_by uuid NOT NULL,
  submitted_at timestamp with time zone,
  submitted_by uuid,

  -- Standard timestamps
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  CONSTRAINT incident_reports_pkey PRIMARY KEY (id),
  CONSTRAINT incident_reports_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT incident_reports_form_submission_id_fkey
    FOREIGN KEY (form_submission_id) REFERENCES public.form_submissions(id) ON DELETE SET NULL,
  CONSTRAINT incident_reports_victim_participant_id_fkey
    FOREIGN KEY (victim_participant_id) REFERENCES public.participants(id) ON DELETE SET NULL,
  CONSTRAINT incident_reports_victim_user_id_fkey
    FOREIGN KEY (victim_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT incident_reports_activity_id_fkey
    FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL,
  CONSTRAINT incident_reports_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT incident_reports_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_incident_reports_organization_id
  ON public.incident_reports(organization_id);

CREATE INDEX IF NOT EXISTS idx_incident_reports_status
  ON public.incident_reports(status);

CREATE INDEX IF NOT EXISTS idx_incident_reports_activity_id
  ON public.incident_reports(activity_id);

CREATE INDEX IF NOT EXISTS idx_incident_reports_victim_participant
  ON public.incident_reports(victim_participant_id);

CREATE INDEX IF NOT EXISTS idx_incident_reports_created_by
  ON public.incident_reports(created_by);

CREATE INDEX IF NOT EXISTS idx_incident_reports_incident_date
  ON public.incident_reports(incident_date DESC);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_incident_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS incident_reports_updated_at_trigger ON public.incident_reports;
CREATE TRIGGER incident_reports_updated_at_trigger
  BEFORE UPDATE ON public.incident_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_incident_reports_updated_at();

COMMENT ON TABLE public.incident_reports IS 'Tracks incident/accident reports with escalation workflow';
COMMENT ON COLUMN public.incident_reports.status IS 'Report status: draft or submitted';
COMMENT ON COLUMN public.incident_reports.victim_type IS 'Type of victim: participant, leader, parent, or other';
COMMENT ON COLUMN public.incident_reports.escalation_sent_to IS 'Snapshot of email addresses that received escalation notification';

-- ============================================================
-- Table 2: incident_escalation_contacts
-- Per-organization configuration of escalation email recipients
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS incident_escalation_contacts_id_seq;

CREATE TABLE IF NOT EXISTS public.incident_escalation_contacts (
  id integer NOT NULL DEFAULT nextval('incident_escalation_contacts_id_seq'::regclass),
  organization_id integer NOT NULL,
  email character varying NOT NULL,
  name character varying,
  role_description character varying,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT incident_escalation_contacts_pkey PRIMARY KEY (id),
  CONSTRAINT incident_escalation_contacts_org_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_escalation_contacts_org
  ON public.incident_escalation_contacts(organization_id);

COMMENT ON TABLE public.incident_escalation_contacts IS 'Per-organization email contacts for incident escalation notifications';
COMMENT ON COLUMN public.incident_escalation_contacts.role_description IS 'Role or title of the contact (e.g., District Commissioner, Safety Officer)';

-- ============================================================
-- Table 3: incident_email_queue
-- Offline-resilient email queue with retry logic
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS incident_email_queue_id_seq;

CREATE TABLE IF NOT EXISTS public.incident_email_queue (
  id integer NOT NULL DEFAULT nextval('incident_email_queue_id_seq'::regclass),
  organization_id integer NOT NULL,
  incident_report_id integer NOT NULL,
  recipient_email character varying NOT NULL,
  recipient_name character varying,
  subject character varying NOT NULL,
  body_text text NOT NULL,
  body_html text,
  status character varying NOT NULL DEFAULT 'pending'::character varying
    CHECK (status::text = ANY (ARRAY['pending'::character varying, 'sending'::character varying, 'sent'::character varying, 'failed'::character varying]::text[])),
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 5,
  last_attempt_at timestamp with time zone,
  error_message text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT incident_email_queue_pkey PRIMARY KEY (id),
  CONSTRAINT incident_email_queue_org_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT incident_email_queue_incident_fkey
    FOREIGN KEY (incident_report_id) REFERENCES public.incident_reports(id) ON DELETE CASCADE
);

-- Partial index for queue processing (only pending/sending items)
CREATE INDEX IF NOT EXISTS idx_incident_email_queue_pending
  ON public.incident_email_queue(status) WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_incident_email_queue_org
  ON public.incident_email_queue(organization_id);

COMMENT ON TABLE public.incident_email_queue IS 'Queue for incident escalation emails with offline retry support';
COMMENT ON COLUMN public.incident_email_queue.attempts IS 'Number of send attempts made';
COMMENT ON COLUMN public.incident_email_queue.max_attempts IS 'Maximum retry attempts before giving up (default 5)';

-- ============================================================
-- Seed: Permissions for incident reports
-- ============================================================

INSERT INTO permissions (permission_key, permission_name, category, description)
VALUES
  ('incidents.view', 'View Incident Reports', 'incidents', 'View incident reports for the organization'),
  ('incidents.manage', 'Manage Incident Reports', 'incidents', 'Create, edit, and submit incident reports')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant incidents.view + incidents.manage to unitadmin, district, leader roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('unitadmin', 'district', 'leader')
  AND p.permission_key IN ('incidents.view', 'incidents.manage')
ON CONFLICT DO NOTHING;

-- Grant incidents.view only to animator role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'animator'
  AND p.permission_key = 'incidents.view'
ON CONFLICT DO NOTHING;
