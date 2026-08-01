-- Migration: alumni consent
--
-- `user_organizations.status` already accepts 'alumni'; nothing ever set it.
-- This adds the consent trail that makes setting it legitimate.
--
-- The rule the columns encode (§8.8 of devdocs/GESTION_ANNEE_SCOUTE.md):
--
--   * alumni is **never** automatic. A year transition keeps posting 'inactive'.
--     Becoming an alumnus takes a deliberate act by the person themselves.
--   * the ask goes out **once**, by email, at the moment access is withdrawn —
--     which is precisely why it cannot require a login. `alumni_invited_at`
--     records that the ask was made, so a second transition does not ask again.
--   * silence is a no. A membership that is invited and never answers stays
--     'inactive' forever, and is a candidate for a future retention purge.
--   * leaving is as easy as joining: `alumni_opted_out_at` records a one-click
--     unsubscribe, and returns the membership to 'inactive'.
--
-- No token is stored. The consent and unsubscribe links carry a signed JWT
-- naming the membership; storing a second copy server-side would only add a
-- table to keep in sync and a secret to leak.
--
-- Safe to run more than once.

BEGIN;

ALTER TABLE user_organizations
  ADD COLUMN IF NOT EXISTS alumni_invited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS alumni_consent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS alumni_opted_out_at timestamptz;

COMMENT ON COLUMN user_organizations.alumni_invited_at IS
  'When the alumni opt-in email was sent. Set so a later transition does not ask a second time; a NULL here on an inactive membership is what makes it a candidate for the invitation.';

COMMENT ON COLUMN user_organizations.alumni_consent_at IS
  'When the person opted in, through the signed link in that email. Only a row with this set may carry status = ''alumni''.';

COMMENT ON COLUMN user_organizations.alumni_opted_out_at IS
  'When the person unsubscribed. The membership goes back to ''inactive''; the timestamp stays as the proof the request was honoured.';

-- Consent is what authorises the status. Enforced rather than merely intended:
-- an alumni audience built from a status nobody consented to is the exact
-- failure this feature exists to avoid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_organizations_alumni_requires_consent'
  ) THEN
    ALTER TABLE user_organizations
      ADD CONSTRAINT user_organizations_alumni_requires_consent
      CHECK (status <> 'alumni' OR alumni_consent_at IS NOT NULL);
  END IF;
END;
$$;

-- The alumni audience is read per organization, and only ever for people who
-- said yes.
CREATE INDEX IF NOT EXISTS user_organizations_alumni_idx
  ON user_organizations (organization_id)
  WHERE status = 'alumni';

-- Inviting departed families is part of running the year transition, which is
-- what produced them; it needs no permission of its own. Reading who the
-- alumni are, and writing to them, is announcement work — hence a permission
-- next to the announcement ones rather than a new family.
INSERT INTO permissions (permission_key, permission_name, category, description)
VALUES ('alumni.manage', 'Manage Alumni', 'communication',
        'Invite departed families to become alumni and address the alumni audience.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
 CROSS JOIN permissions p
 WHERE p.permission_key = 'alumni.manage'
   AND r.role_name IN ('unitadmin', 'district', 'administration')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Announcement audience
--
-- An announcement addresses either the unit or its alumni, never both. The
-- column exists so that "never included in a general send" is a property of the
-- stored announcement and not of the code path that happened to build it.
-- ---------------------------------------------------------------------------

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'members';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'announcements_audience_check'
  ) THEN
    ALTER TABLE announcements
      ADD CONSTRAINT announcements_audience_check
      CHECK (audience IN ('members', 'alumni'));
  END IF;
END;
$$;

COMMENT ON COLUMN announcements.audience IS
  'Who this announcement is for. ''members'' is the unit; ''alumni'' is the consented former families, who are never reached by a members send and never by group or role filters.';

COMMIT;
