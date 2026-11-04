-- Written sections of the camp plan (#1318): what the camp permit asks the team to write.
-- Two kinds coexist:
--   * a camp's own sections (V.C.P.R.E.F., theme and story, motivation system), and the games
--     kept for bad weather, chosen from the unit's activity library;
--   * sections stable from year to year (rules of life, camp rules, code of ethics, emergency
--     procedures), written once as the unit's templates. A camp follows its unit's template
--     unless it writes its own text for that camp.
-- Section keys are config/camp_plan.json; the checks below list the same values.
SELECT setval(pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1, false);
INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES ('camp_plan_templates.manage', 'Manage camp plan templates', 'camp_plan',
  'Write the unit''s rules of life, camp rules, code of ethics and emergency procedures that every camp plan starts from')
ON CONFLICT (permission_key) DO NOTHING;

-- Whoever plans the unit's meetings and camps writes the texts every camp starts from.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.permission_key = 'camp_plan_templates.manage' AND r.data_scope = 'organization' AND EXISTS (
  SELECT 1 FROM public.role_permissions rp JOIN public.permissions held ON held.id = rp.permission_id
   WHERE rp.role_id = r.id AND held.permission_key = 'meetings.manage')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.camp_plan_templates (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL CHECK (section_key IN ('rules_of_life', 'camp_rules', 'code_of_ethics', 'emergency_procedures')),
  -- NULL once emptied: the row stays, so its version keeps growing and a stale editor is still refused.
  body_html TEXT CHECK (length(body_html) BETWEEN 1 AND 50000),
  body_text TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, section_key)
);

CREATE TABLE IF NOT EXISTS public.camp_plan_sections (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL,
  section_key TEXT NOT NULL CHECK (section_key IN (
    'vcpref_wanted', 'vcpref_chosen', 'vcpref_prepared', 'vcpref_realized', 'vcpref_evaluated', 'vcpref_celebrated',
    'theme', 'motivation', 'rules_of_life', 'camp_rules', 'code_of_ethics', 'emergency_procedures')),
  -- NULL once emptied: the row stays, so its version keeps growing and a stale editor is still refused.
  body_html TEXT CHECK (length(body_html) BETWEEN 1 AND 50000),
  body_text TEXT,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, meeting_id, section_key),
  FOREIGN KEY (meeting_id, organization_id) REFERENCES public.year_plan_meetings(id, organization_id) ON DELETE CASCADE
);

-- A camp's bad-weather games are activities of its own unit's library.
CREATE UNIQUE INDEX IF NOT EXISTS activity_library_id_organization
  ON public.activity_library (id, organization_id);

CREATE TABLE IF NOT EXISTS public.camp_plan_rain_games (
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL,
  activity_library_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, meeting_id, activity_library_id),
  FOREIGN KEY (meeting_id, organization_id) REFERENCES public.year_plan_meetings(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (activity_library_id, organization_id) REFERENCES public.activity_library(id, organization_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.camp_plan_templates IS 'A unit''s texts for the camp plan sections stable from year to year (rules of life, camp rules, code of ethics, emergency procedures). Every camp follows them unless it writes its own. Rich text rebuilt by utils/richText.js; body_text is its plain version. An emptied template keeps its row with NULL text, so its version never goes back.';
COMMENT ON TABLE public.camp_plan_sections IS 'One camp''s written plan sections: its own (V.C.P.R.E.F., theme, motivation) and, for a stable section, the text the camp wrote instead of its unit''s template. No row, or a row with NULL text (emptied, kept so its version never goes back), means not written, or following the template.';
COMMENT ON COLUMN public.camp_plan_sections.needs_review IS 'Copied from an earlier camp (#1256) and not yet saved again: a draft to reread.';
COMMENT ON TABLE public.camp_plan_rain_games IS 'Games a camp keeps for bad weather, chosen from its unit''s activity library, in the order the team listed them.';
