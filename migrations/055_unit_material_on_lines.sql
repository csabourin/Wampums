-- A schedule line may list, beside catalogue articles, an inventory item the
-- unit may use: its own, one shared with it, or one of its local group. Each
-- entry names exactly one of the two. Whether the unit may use an item is
-- checked by services/equipmentAccess.js when the entry is written; an item
-- stops being listed only when it is deleted.
ALTER TABLE public.meeting_activity_equipment
  ADD COLUMN IF NOT EXISTS equipment_item_id INTEGER REFERENCES public.equipment_items(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_activity_equipment
  ALTER COLUMN catalog_item_id DROP NOT NULL;

ALTER TABLE public.meeting_activity_equipment
  DROP CONSTRAINT IF EXISTS meeting_activity_equipment_one_kind;
ALTER TABLE public.meeting_activity_equipment
  ADD CONSTRAINT meeting_activity_equipment_one_kind
  CHECK (num_nonnulls(catalog_item_id, equipment_item_id) = 1);

-- Each article, and each inventory item, once per line.
ALTER TABLE public.meeting_activity_equipment
  DROP CONSTRAINT IF EXISTS meeting_activity_equipment_meeting_activity_id_catalog_item_key;
CREATE UNIQUE INDEX IF NOT EXISTS meeting_activity_equipment_article_once
  ON public.meeting_activity_equipment (meeting_activity_id, catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meeting_activity_equipment_inventory_once
  ON public.meeting_activity_equipment (meeting_activity_id, equipment_item_id)
  WHERE equipment_item_id IS NOT NULL;

COMMENT ON TABLE public.meeting_activity_equipment IS
  'What a schedule line needs, with quantities, beside its free-text material: a catalogue article of the unit, or an inventory item the unit may use (exactly one).';
