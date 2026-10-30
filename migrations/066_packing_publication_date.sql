-- Staff see when families last received a packing list, beside their unpublished changes.
ALTER TABLE public.packing_list_publications ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
COMMENT ON COLUMN public.packing_list_publications.published_at IS 'When staff last published this list to families';
