-- Announcement templates show apostrophes, not double quotes.
--
-- The French templates were loaded with every apostrophe stored as a double
-- quote ("Merci d"apporter", "L"équipe"), so emails built from them read the
-- same way. Only a quote between two letters is an elided apostrophe; quotes
-- around a word were meant as quotes and stay. In the jsonb text form an
-- embedded quote is written \", which is what the pattern matches.

UPDATE public.organization_settings
SET setting_value = regexp_replace(
      setting_value::text,
      '([[:alpha:]])\\"(?=[[:alpha:]])',
      '\1''',
      'g'
    )::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE setting_key = 'announcement_templates'
  AND setting_value::text ~ '[[:alpha:]]\\"[[:alpha:]]';
