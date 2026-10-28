-- Legacy records were filed under a unit, which does not establish real ownership.
-- Leave their owner unspecified until someone identifies the unit or Scout group.
ALTER TABLE public.equipment_items ADD COLUMN IF NOT EXISTS owner_type TEXT;
ALTER TABLE public.equipment_items ADD COLUMN IF NOT EXISTS owner_local_group_id INTEGER
  REFERENCES public.local_groups(id) ON DELETE RESTRICT;
ALTER TABLE public.equipment_items DROP CONSTRAINT IF EXISTS equipment_items_owner_check;
ALTER TABLE public.equipment_items ADD CONSTRAINT equipment_items_owner_check CHECK (
  (owner_type IS NULL AND owner_local_group_id IS NULL)
  OR (owner_type IS NOT NULL AND ((owner_type = 'unit' AND owner_local_group_id IS NULL)
    OR (owner_type = 'group' AND owner_local_group_id IS NOT NULL)))
);
CREATE INDEX IF NOT EXISTS equipment_items_group_owner ON public.equipment_items(owner_local_group_id)
  WHERE owner_type = 'group';
COMMENT ON COLUMN public.equipment_items.organization_id IS 'Unit maintaining the record. Real ownership is explicit in owner_type / owner_local_group_id; legacy ownership is unspecified.';
