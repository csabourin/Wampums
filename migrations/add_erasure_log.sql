-- Migration: right to erasure
--
-- The whole scout year model rests on "nothing is ever deleted". A family that
-- asks to be forgotten is the one case where that has to yield: keeping their
-- data because our architecture prefers it is not a defence under Loi 25.
--
-- This adds the ledger that records an erasure happened, and the permission that
-- restricts it. The erasure itself lives in services/erasure.js.
--
-- The ledger deliberately holds **no personal data** — no name, no email, no
-- participant id. It answers "was this request honoured, by whom, when, and how
-- much did it remove", which is what you need to demonstrate compliance and to
-- explain a gap in a count later. Anything more would rebuild the person we were
-- asked to erase.
--
-- Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS erasure_log (
  id                  serial PRIMARY KEY,
  organization_id     integer NOT NULL REFERENCES organizations(id),
  performed_at        timestamptz NOT NULL DEFAULT now(),
  performed_by        uuid REFERENCES users(id),
  participants_erased integer NOT NULL DEFAULT 0,
  guardians_erased    integer NOT NULL DEFAULT 0,
  users_erased        integer NOT NULL DEFAULT 0,
  users_retained      integer NOT NULL DEFAULT 0,
  rows_deleted        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS erasure_log_org_idx
  ON erasure_log (organization_id, performed_at DESC);

COMMENT ON TABLE erasure_log IS
  'One row per honoured erasure request. Holds counts only, never a name, an email or a participant id: the point is to prove the request was carried out without reconstituting the person.';

COMMENT ON COLUMN erasure_log.users_retained IS
  'Parent accounts deliberately kept: they still have another enrolled child, or they hold a non-parent role in the unit. Reported so the admin knows the request was only partly applicable.';

-- ---------------------------------------------------------------------------
-- Permission
--
-- Erasure is irreversible and crosses families, so it sits with the people
-- accountable for the unit rather than with whoever can edit a participant.
-- Deliberately NOT granted to 'animation'.
-- ---------------------------------------------------------------------------

INSERT INTO permissions (permission_key, permission_name, category, description)
VALUES ('participants.erase', 'Erase Participant Data', 'participants',
        'Permanently erase a participant and their family at their request. Irreversible.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
 CROSS JOIN permissions p
 WHERE p.permission_key = 'participants.erase'
   AND r.role_name IN ('unitadmin', 'district')
ON CONFLICT DO NOTHING;

COMMIT;
