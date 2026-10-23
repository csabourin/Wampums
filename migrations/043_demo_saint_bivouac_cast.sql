-- Saint-Bivouac gets its cast.
--
-- The demo unit (demo_sign_in) showed placeholder names that said nothing
-- about the unit or the app. Its youth, its groups, its demo accounts and
-- their guardians now carry invented names, read the same in English and
-- French: French puns for the youth (Annie Versaire, Guy Mauve…), animal
-- names spelled alike in both languages for the groups, and Akela for the
-- leader account. The demo missions (lang/*.json, demo_mission_*) refer to
-- the first few of them.
--
-- Only records that belong to demo units alone are renamed: a child, a
-- guardian or an account also known to an ordinary unit is left as it is.
-- Names are assigned by id order, so running this again changes nothing.

WITH demo_units AS (
  SELECT organization_id
    FROM public.organization_settings
   WHERE setting_key = 'demo_sign_in'
     AND setting_value IN ('true'::jsonb, '"true"'::jsonb)
), demo_children AS (
  SELECT DISTINCT e.participant_id
    FROM public.participant_enrollments e
    JOIN demo_units d ON d.organization_id = e.organization_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.participant_enrollments other
      WHERE other.participant_id = e.participant_id
        AND other.organization_id NOT IN (SELECT organization_id FROM demo_units)
   )
), ranked AS (
  SELECT participant_id, row_number() OVER (ORDER BY participant_id) AS n
    FROM demo_children
), cast_list (n, first_name, last_name) AS (
  VALUES
    (1, 'Annie', 'Versaire'),
    (2, 'Paul', 'Ochon'),
    (3, 'Théo', 'Courant'),
    (4, 'Sarah', 'Croche'),
    (5, 'Guy', 'Mauve'),
    (6, 'Lara', 'Clette'),
    (7, 'Gilles', 'Ensauvetage'),
    (8, 'Alain', 'Provist'),
    (9, 'Aude', 'Javel'),
    (10, 'Jean', 'Bonneau'),
    (11, 'Marie', 'Golo'),
    (12, 'Sam', 'Suffit'),
    (13, 'Mélodie', 'Gamelle'),
    (14, 'Yves', 'Remord'),
    (15, 'Pat', 'Atras'),
    (16, 'Gaston', 'Lalune')
)
UPDATE public.participants p
   SET first_name = c.first_name,
       last_name = c.last_name
  FROM ranked r
  JOIN cast_list c ON c.n = r.n
 WHERE p.id = r.participant_id
   AND (p.first_name, p.last_name) IS DISTINCT FROM (c.first_name, c.last_name);

WITH demo_units AS (
  SELECT organization_id
    FROM public.organization_settings
   WHERE setting_key = 'demo_sign_in'
     AND setting_value IN ('true'::jsonb, '"true"'::jsonb)
), ranked AS (
  SELECT g.id, row_number() OVER (PARTITION BY g.organization_id ORDER BY g.id) AS n
    FROM public.groups g
    JOIN demo_units d ON d.organization_id = g.organization_id
), group_names (n, name) AS (
  VALUES (1, 'Chinchillas'), (2, 'Caribous'), (3, 'Coyotes'), (4, 'Koalas'), (5, 'Lynx'), (6, 'Bisons')
)
UPDATE public.groups g
   SET name = gn.name
  FROM ranked r
  JOIN group_names gn ON gn.n = r.n
 WHERE g.id = r.id
   AND g.name IS DISTINCT FROM gn.name;

-- Guardians known only to demo children take their first child's family name.
WITH demo_units AS (
  SELECT organization_id
    FROM public.organization_settings
   WHERE setting_key = 'demo_sign_in'
     AND setting_value IN ('true'::jsonb, '"true"'::jsonb)
), demo_children AS (
  SELECT DISTINCT e.participant_id
    FROM public.participant_enrollments e
    JOIN demo_units d ON d.organization_id = e.organization_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.participant_enrollments other
      WHERE other.participant_id = e.participant_id
        AND other.organization_id NOT IN (SELECT organization_id FROM demo_units)
   )
), demo_guardians AS (
  SELECT pg.guardian_id, MIN(pg.participant_id) AS first_child
    FROM public.participant_guardians pg
   GROUP BY pg.guardian_id
  HAVING bool_and(pg.participant_id IN (SELECT participant_id FROM demo_children))
), ranked AS (
  SELECT guardian_id, first_child, row_number() OVER (ORDER BY guardian_id) AS n
    FROM demo_guardians
), first_names (n, prenom) AS (
  VALUES
    (1, 'Rémi'), (2, 'Rose'), (3, 'Hector'), (4, 'Gisèle'), (5, 'Marcel'), (6, 'Odette'),
    (7, 'Gaspard'), (8, 'Huguette'), (9, 'Firmin'), (10, 'Berthe'), (11, 'Lucien'), (12, 'Simone'),
    (13, 'Edgar'), (14, 'Paulette'), (15, 'Ernest'), (16, 'Colette')
)
UPDATE public.parents_guardians g
   SET prenom = fn.prenom,
       nom = child.last_name
  FROM ranked r
  JOIN first_names fn ON fn.n = r.n
  JOIN public.participants child ON child.id = r.first_child
 WHERE g.id = r.guardian_id
   AND (g.prenom, g.nom) IS DISTINCT FROM (fn.prenom, child.last_name);

-- Demo accounts that belong to demo units alone: Akela leads, and the
-- parent view signs in as the guardian it is linked to.
WITH demo_units AS (
  SELECT organization_id
    FROM public.organization_settings
   WHERE setting_key = 'demo_sign_in'
     AND setting_value IN ('true'::jsonb, '"true"'::jsonb)
), demo_accounts AS (
  SELECT uo.user_id, bool_or(r.role_name = 'demoadmin') AS leads
    FROM public.user_organizations uo
    JOIN demo_units d ON d.organization_id = uo.organization_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
    JOIN public.roles r ON r.id = role_id_text::integer
   WHERE r.role_name IN ('demoadmin', 'demoparent')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_organizations other
        WHERE other.user_id = uo.user_id
          AND other.organization_id NOT IN (SELECT organization_id FROM demo_units)
     )
   GROUP BY uo.user_id
), named AS (
  SELECT a.user_id,
         CASE
           WHEN a.leads THEN 'Akela'
           ELSE COALESCE(
             (SELECT g.prenom || ' ' || g.nom FROM public.parents_guardians g
               WHERE g.user_uuid = a.user_id ORDER BY g.id LIMIT 1),
             'Rémi Fasol'
           )
         END AS full_name
    FROM demo_accounts a
)
UPDATE public.users u
   SET full_name = n.full_name
  FROM named n
 WHERE u.id = n.user_id
   AND u.full_name IS DISTINCT FROM n.full_name;
