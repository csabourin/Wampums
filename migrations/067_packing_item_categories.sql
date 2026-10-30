-- Personal packing items are grouped by category (config/personal_equipment.json CATEGORIES).
-- NULL keeps older items readable; the SPA places them by their template key, else under "other".
ALTER TABLE public.personal_equipment_items ADD COLUMN IF NOT EXISTS category VARCHAR(20);
COMMENT ON COLUMN public.personal_equipment_items.category IS 'Packing category key; validated against config/personal_equipment.json CATEGORIES';
