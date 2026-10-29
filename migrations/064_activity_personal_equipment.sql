-- Common content for activities without a planner camp. No packing progress.
CREATE TABLE IF NOT EXISTS public.activity_personal_equipment_lists (
 organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 activity_id INTEGER NOT NULL,
 content JSONB NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 PRIMARY KEY (organization_id, activity_id),
 FOREIGN KEY (activity_id, organization_id) REFERENCES public.activities(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.activity_personal_equipment_translations (
 organization_id INTEGER NOT NULL, activity_id INTEGER NOT NULL, version INTEGER NOT NULL,
 language VARCHAR(12) NOT NULL, content JSONB NOT NULL,
 PRIMARY KEY (organization_id, activity_id, version, language),
 FOREIGN KEY (organization_id, activity_id) REFERENCES public.activity_personal_equipment_lists(organization_id, activity_id) ON DELETE CASCADE
);
