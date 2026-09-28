-- Badge templates point at the translations that exist for them.
--
-- The key of some templates was built by replacing everything outside
-- [a-z0-9] with '_' *before* lowercasing the name. Capitals and accented
-- letters were lost with the punctuation:
--
--   Débrouillard comme Kaa      -> badge_template__brouillard_comme_aa
--   Solidaire comme Frère Gris  -> badge_template__olidaire_comme_r_re_ris
--
-- lang/*.json holds the keys built the other way round, lowercasing first
-- (badge_template_d_brouillard_comme_kaa, badge_template_solidaire_comme_fr_re_gris),
-- so those badges were never translated: English readers saw the French name.
--
-- Only a translation_key that is exactly the damaged form of the template's
-- current name is rewritten; a key someone chose by hand does not match it.
-- template_key is left alone: it is the unique key per unit, and routes/badges.js
-- still looks templates up with the same expression that produced it.
-- Once rewritten a key no longer matches the damaged form, so a second run
-- changes nothing.

UPDATE badge_templates
   SET translation_key = 'badge_template_' || regexp_replace(lower(name), '[^a-z0-9]+', '_', 'g'),
       updated_at = NOW()
 WHERE translation_key = 'badge_template_' || lower(regexp_replace(name, '[^a-z0-9]+', '_', 'g'))
   AND translation_key <> 'badge_template_' || regexp_replace(lower(name), '[^a-z0-9]+', '_', 'g');
