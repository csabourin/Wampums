-- Coordinate erasure when more than one organization owns participant data.

BEGIN;

CREATE TABLE IF NOT EXISTS participant_erasure_approvals (
  participant_id integer NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, organization_id)
);

CREATE INDEX IF NOT EXISTS participant_erasure_approvals_org_idx
  ON participant_erasure_approvals (organization_id, approved_at DESC);

COMMENT ON TABLE participant_erasure_approvals IS
  'Per-organization approvals for erasing a participant whose global record is owned by multiple organizations. Rows disappear with the participant.';

COMMIT;
