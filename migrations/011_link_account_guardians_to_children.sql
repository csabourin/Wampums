-- Families who registered appear among their children's guardians.
--
-- A child's guardians -- the Parent/Guardian section of its form, and the
-- emergency contact list -- are the contact records linked to it in
-- participant_guardians. Parents who registered through older paths, and
-- co-parents given access through a family link, have an account with access
-- to the child and often a contact record tied to that account, but no link
-- to the child. They were missing from the emergency contacts.
--
-- This links, for each account with access to a child, the contact record
-- that belongs to that account, when there is one and it is not linked yet.
-- The record is the one the Parent/Guardian form now offers for that account:
-- tied to it by user_uuid first, then by the older guardian_users mapping,
-- then by the account's own address on a record no other account claims
-- (neither by user_uuid nor through guardian_users).
--
-- Only an account that is an active member of a unit where the child is
-- enrolled counts: user_participants carries no unit of its own. Accounts
-- without a contact record are left alone; there is nothing to link, and the
-- form offers them pre-filled from the account.
--
-- Only participant_guardians rows are inserted, with no relationship (lien):
-- the family fills that in the next time they save the form.

INSERT INTO participant_guardians (guardian_id, participant_id)
SELECT DISTINCT ON (up.user_id, up.participant_id) g.id, up.participant_id
FROM user_participants up
JOIN users u ON u.id = up.user_id
JOIN parents_guardians g
  ON g.user_uuid = u.id
  OR EXISTS (SELECT 1 FROM guardian_users gu WHERE gu.guardian_id = g.id AND gu.user_id = u.id)
  OR (g.user_uuid IS NULL
      AND lower(g.courriel) = lower(u.email)
      AND NOT EXISTS (
        SELECT 1 FROM guardian_users other
        WHERE other.guardian_id = g.id AND other.user_id IS NOT NULL AND other.user_id <> u.id
      ))
WHERE EXISTS (
    SELECT 1
    FROM participant_enrollments pe
    JOIN user_organizations uo
      ON uo.organization_id = pe.organization_id
     AND uo.user_id = up.user_id
     AND uo.status = 'active'
    WHERE pe.participant_id = up.participant_id
  )
  -- The account is already among this child's guardians.
  AND NOT EXISTS (
    SELECT 1
    FROM participant_guardians linked
    JOIN parents_guardians lg ON lg.id = linked.guardian_id
    WHERE linked.participant_id = up.participant_id
      AND (lg.user_uuid = u.id
           OR lower(lg.courriel) = lower(u.email)
           OR EXISTS (SELECT 1 FROM guardian_users lgu WHERE lgu.guardian_id = lg.id AND lgu.user_id = u.id))
  )
ORDER BY up.user_id, up.participant_id, (g.user_uuid = u.id) DESC NULLS LAST, g.id
ON CONFLICT (guardian_id, participant_id) DO NOTHING;
