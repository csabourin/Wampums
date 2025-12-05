-- Add archived column to fundraisers table
ALTER TABLE public.fundraisers 
ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- Create index for better performance when filtering archived fundraisers
CREATE INDEX IF NOT EXISTS idx_fundraisers_archived 
ON public.fundraisers(archived);

-- Update any existing fundraisers to not be archived
UPDATE public.fundraisers 
SET archived = false 
WHERE archived IS NULL;
