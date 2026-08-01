-- Migration: who moved a participant to a sister unit, and when
--
-- `participant_enrollments.transferred_to_organization_id` has existed since the
-- scout year migration and nothing ever filled it, because no interface
-- performed a transfer (§8.5). Now that one does, the destination alone is not
-- enough of a record: a transfer is the one ordinary operation that moves a
-- child's file between two tenants, so it has to say who decided it.
--
-- Deliberately two columns on the enrollment rather than a ledger table. The
-- closed enrollment already carries the outcome — `status = 'transferred'`,
-- `ended_on`, `exit_reason`, `transferred_to_organization_id`; all that was
-- missing was provenance, and provenance belongs next to what it explains.
--
-- Safe to run more than once.

BEGIN;

ALTER TABLE participant_enrollments
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS transferred_by uuid REFERENCES users(id);

COMMENT ON COLUMN participant_enrollments.transferred_at IS
  'When the transfer was carried out. Distinct from ended_on, which is the date the enrollment stopped counting and may be back-dated to the year boundary.';

COMMENT ON COLUMN participant_enrollments.transferred_by IS
  'Who carried out the transfer. A transfer moves a file between two tenants, which is why it names a person rather than only a destination.';

CREATE INDEX IF NOT EXISTS participant_enrollments_transferred_idx
  ON participant_enrollments (transferred_to_organization_id)
  WHERE transferred_to_organization_id IS NOT NULL;

COMMIT;
