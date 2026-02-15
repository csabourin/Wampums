BEGIN;

ALTER TABLE public.badge_templates
  ADD COLUMN IF NOT EXISTS program_type varchar(30) NOT NULL DEFAULT 'legacy_badge',
  ADD COLUMN IF NOT EXISTS official_key varchar(255),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS requirements jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.badge_templates
SET official_key = lower(
  trim(BOTH '_' FROM regexp_replace(
    concat('legacy:', coalesce(template_key, id::text)),
    '[^a-zA-Z0-9:]+',
    '_',
    'g'
  ))
)
WHERE official_key IS NULL;

UPDATE public.badge_templates
SET program_type = CASE
  WHEN lower(coalesce(template_key, '')) LIKE 'oas:%' THEN 'oas'
  WHEN lower(coalesce(template_key, '')) LIKE 'pab:%' THEN 'pab'
  WHEN lower(coalesce(template_key, '')) LIKE 'top:%' THEN 'top'
  ELSE 'legacy_badge'
END;

CREATE INDEX IF NOT EXISTS idx_badge_templates_program_type
  ON public.badge_templates (program_type);

CREATE INDEX IF NOT EXISTS idx_badge_templates_official_key
  ON public.badge_templates (official_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_badge_templates_org_official_key_version_unique
  ON public.badge_templates (organization_id, official_key, version)
  WHERE official_key IS NOT NULL;

COMMIT;
