-- An account's name comes from its own contact record.
--
-- The same person is stored twice: users.full_name, typed once at sign-up, and
-- the contact record (parents_guardians.prenom / nom) the family fills in on
-- the Parent/Guardian form and the unit calls in an emergency. Nothing kept
-- them together, so a parent who typed their child's name at sign-up showed
-- up as that child's parent on the account screens while the emergency
-- contacts were right.
--
-- The contact record is what the family keeps up to date, so it wins. Only a
-- record tied to the account by user_uuid counts: the older guardian_users
-- mapping and address matching can point at another person's record. With
-- several, the oldest is the account's own, as routes/guardians.js already
-- treats it. A record whose first and last names are the same word is the
-- placeholder services/accountProvisioning.js makes from a one-word name or
-- an address; it does not override the account. Accounts without a record --
-- leaders, administrators -- keep users.full_name.
--
-- Nothing is rewritten here. Saves to either record now bring users.full_name
-- in line through this view (services/accountNames.js).

CREATE INDEX IF NOT EXISTS idx_parents_guardians_user_uuid
  ON public.parents_guardians (user_uuid)
  WHERE user_uuid IS NOT NULL;

CREATE OR REPLACE VIEW public.account_display_names WITH (security_invoker = on) AS
SELECT u.id AS user_id,
       COALESCE(
         CASE
           WHEN lower(btrim(own.prenom)) <> lower(btrim(own.nom))
             THEN NULLIF(btrim(concat_ws(' ', btrim(own.prenom), btrim(own.nom))), '')
         END,
         u.full_name
       ) AS display_name,
       own.id AS guardian_id
FROM public.users u
LEFT JOIN LATERAL (
  SELECT g.id, g.prenom, g.nom
  FROM public.parents_guardians g
  WHERE g.user_uuid = u.id
  ORDER BY g.id
  LIMIT 1
) own ON true;

COMMENT ON VIEW public.account_display_names IS 'The name to show for an account: its own contact record (parents_guardians by user_uuid, oldest first) when it has one, else users.full_name. users.full_name is kept in line on every save (services/accountNames.js).';
