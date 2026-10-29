-- Seasonal personal camp checklists; only common content is stored; checkmarks remain in the browser.
SELECT setval(pg_get_serial_sequence('public.permissions','id'),COALESCE((SELECT MAX(id) FROM public.permissions),0)+1,false);
INSERT INTO public.permissions (permission_key,permission_name,category,description) VALUES
 ('personal_equipment.view','View personal equipment lists','personal_equipment','Read published camp lists for linked children'),
 ('personal_equipment.manage','Manage personal equipment lists','personal_equipment','Review and publish bilingual personal camp equipment lists')
ON CONFLICT (permission_key) DO NOTHING;
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.organization_id IS NULL AND r.role_name IN ('parent','demoparent') AND p.permission_key='personal_equipment.view'
ON CONFLICT DO NOTHING;
UPDATE public.permissions SET self_scoped = TRUE WHERE permission_key = 'personal_equipment.view';
CREATE TABLE IF NOT EXISTS public.personal_equipment_lists (
 organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 meeting_id INTEGER NOT NULL,
 season TEXT NOT NULL CHECK (season IN ('summer','winter','shoulder')),
 nights INTEGER NOT NULL CHECK (nights BETWEEN 0 AND 30),
 stay_type TEXT NOT NULL CHECK (stay_type IN ('day','cabin','tent')),
 notes_fr TEXT NOT NULL DEFAULT '', notes_en TEXT NOT NULL DEFAULT '',
 published BOOLEAN NOT NULL DEFAULT FALSE,
 reviewed_at TIMESTAMPTZ, updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 PRIMARY KEY (organization_id,meeting_id),
 FOREIGN KEY (meeting_id,organization_id) REFERENCES public.year_plan_meetings(id,organization_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.personal_equipment_items (
 organization_id INTEGER NOT NULL, meeting_id INTEGER NOT NULL, item_key VARCHAR(80) NOT NULL,
 label_fr VARCHAR(240) NOT NULL DEFAULT '',
 label_en VARCHAR(240) NOT NULL DEFAULT '',
 CHECK (length(btrim(label_fr)) > 0 OR length(btrim(label_en)) > 0),
 quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
 catalog_item_id INTEGER, position INTEGER NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY (organization_id,meeting_id,item_key),
 FOREIGN KEY (organization_id,meeting_id) REFERENCES public.personal_equipment_lists(organization_id,meeting_id) ON DELETE CASCADE,
 FOREIGN KEY (catalog_item_id,organization_id) REFERENCES public.equipment_catalog_items(id,organization_id)
);

CREATE TABLE IF NOT EXISTS public.personal_equipment_translations (
 organization_id INTEGER NOT NULL, meeting_id INTEGER NOT NULL, version INTEGER NOT NULL,
 language VARCHAR(12) NOT NULL, content JSONB NOT NULL,
 PRIMARY KEY (organization_id, meeting_id, version, language),
 FOREIGN KEY (organization_id, meeting_id) REFERENCES public.personal_equipment_lists(organization_id, meeting_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.personal_equipment_translations IS 'Shared translations of common list text, versioned with stable item keys. No child, user or checkmark state.';
COMMENT ON TABLE public.personal_equipment_lists IS 'Team-reviewed seasonal personal equipment list for one camp; family checkmarks are never stored server-side.';
