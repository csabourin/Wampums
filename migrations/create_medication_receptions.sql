-- Create medication_receptions table to track when medications are received from parents/guardians
-- This tracks medication check-in at activities/camps

CREATE SEQUENCE IF NOT EXISTS medication_receptions_id_seq;

CREATE TABLE IF NOT EXISTS public.medication_receptions (
  id integer NOT NULL DEFAULT nextval('medication_receptions_id_seq'::regclass),
  organization_id integer NOT NULL,
  activity_id integer,
  medication_requirement_id integer NOT NULL,
  participant_id integer NOT NULL,
  participant_medication_id integer,

  -- Reception status: 'received', 'not_received', 'partial'
  status character varying NOT NULL DEFAULT 'not_received'::character varying
    CHECK (status::text = ANY (ARRAY['received'::character varying, 'not_received'::character varying, 'partial'::character varying]::text[])),

  -- Free-text quantity field (e.g., "1 bottle of 30 pills", "EpiPen x2")
  quantity_received text,

  -- Notes visible during medication dispensing
  reception_notes text,

  -- Tracking information
  received_by uuid, -- Staff member who collected the medication
  received_at timestamp with time zone,

  -- Timestamps
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,

  -- Primary key
  CONSTRAINT medication_receptions_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT medication_receptions_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT medication_receptions_activity_id_fkey
    FOREIGN KEY (activity_id)
    REFERENCES public.activities(id)
    ON DELETE CASCADE,

  CONSTRAINT medication_receptions_medication_requirement_id_fkey
    FOREIGN KEY (medication_requirement_id)
    REFERENCES public.medication_requirements(id)
    ON DELETE CASCADE,

  CONSTRAINT medication_receptions_participant_id_fkey
    FOREIGN KEY (participant_id)
    REFERENCES public.participants(id)
    ON DELETE CASCADE,

  CONSTRAINT medication_receptions_participant_medication_id_fkey
    FOREIGN KEY (participant_medication_id)
    REFERENCES public.participant_medications(id)
    ON DELETE SET NULL,

  CONSTRAINT medication_receptions_received_by_fkey
    FOREIGN KEY (received_by)
    REFERENCES public.users(id)
    ON DELETE SET NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_medication_receptions_organization_id
  ON public.medication_receptions(organization_id);

CREATE INDEX IF NOT EXISTS idx_medication_receptions_activity_id
  ON public.medication_receptions(activity_id);

CREATE INDEX IF NOT EXISTS idx_medication_receptions_participant_id
  ON public.medication_receptions(participant_id);

CREATE INDEX IF NOT EXISTS idx_medication_receptions_status
  ON public.medication_receptions(status);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_medication_receptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_receptions_updated_at_trigger
  BEFORE UPDATE ON public.medication_receptions
  FOR EACH ROW
  EXECUTE FUNCTION update_medication_receptions_updated_at();

COMMENT ON TABLE public.medication_receptions IS 'Tracks when medications are received from parents/guardians at activities';
COMMENT ON COLUMN public.medication_receptions.status IS 'Reception status: received, not_received, or partial';
COMMENT ON COLUMN public.medication_receptions.quantity_received IS 'Free-text quantity (e.g., "1 bottle of 30 pills")';
COMMENT ON COLUMN public.medication_receptions.reception_notes IS 'Notes visible during medication dispensing';
