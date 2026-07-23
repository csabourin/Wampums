-- Record explicit guardian refusals for activity permission requests.

ALTER TABLE permission_slips
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_by TEXT;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname
    INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = current_schema()
     AND rel.relname = 'permission_slips'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%status%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE permission_slips DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END $$;

ALTER TABLE permission_slips
  ADD CONSTRAINT permission_slips_status_check
  CHECK (
    status IN (
      'pending',
      'signed',
      'declined',
      'revoked',
      'expired',
      'archived'
    )
  );
