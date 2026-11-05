-- Allergies in the camp lists (#1319, third slice).
--
-- The camp permit lists the allergies of the camp's youth and adults, with the person to notify.
-- Youth allergies already live in each youth's health form (fiche_sante). Adults had nowhere to say
-- theirs: an adult may declare their own, voluntarily, and nobody else can write it for them. Only
-- the declaration is kept, on the person, shared by every unit they belong to.
--
-- Reading allergies in the camp lists takes a permission of its own, given by default to the roles
-- that already read health forms across the unit: those holding the health and medication reports
-- (reports.view, medication.view, medication.manage) or allowed to view the unit's fiche_sante
-- form. A role that sees only its own children never receives it. The district role receives it
-- through its trigger.
SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1, false);
INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES ('camp_allergies.view', 'View allergies in camp lists', 'camp_plan',
  'Read the allergies of a camp''s youth (from their health forms) and of its team (as each adult declared them)')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.permission_key = 'camp_allergies.view' AND r.data_scope = 'organization' AND (
  EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions held ON held.id = rp.permission_id
           WHERE rp.role_id = r.id AND held.permission_key IN ('reports.view', 'medication.view', 'medication.manage'))
  OR EXISTS (SELECT 1 FROM public.form_permissions fp
               JOIN public.organization_form_formats f ON f.id = fp.form_format_id
              WHERE fp.role_id = r.id AND f.form_type = 'fiche_sante' AND fp.can_view))
ON CONFLICT DO NOTHING;

-- What an adult says about their own allergies. It belongs to the person, whatever their units,
-- and only they write it. A unit reads it only for its active members on a camp's team.
CREATE TABLE IF NOT EXISTS public.member_allergy_declarations (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  allergies TEXT NOT NULL CHECK (length(btrim(allergies)) BETWEEN 1 AND 1000),
  carries_epipen BOOLEAN NOT NULL DEFAULT FALSE,
  person_to_notify TEXT CHECK (person_to_notify IS NULL OR length(person_to_notify) <= 200),
  declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.member_allergy_declarations IS
  'Allergies a person declared for themselves, written only by them and shared by their units. Read in a camp''s lists, for that camp''s active team members, by holders of camp_allergies.view.';
