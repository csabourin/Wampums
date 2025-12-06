-- Add inscription_date column to participant_organizations table
ALTER TABLE public.participant_organizations
ADD COLUMN IF NOT EXISTS inscription_date date;

-- Create index for better performance when querying by inscription_date
CREATE INDEX IF NOT EXISTS idx_participant_organizations_inscription_date
ON public.participant_organizations(inscription_date);
