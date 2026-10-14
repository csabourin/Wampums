-- Nicknames for youth and leaders.
--
-- In a unit, people often go by another name than the one on their record: a
-- cub called Max rather than Maximilien, a leader known by a totem name
-- (Akela, Baloo). When a nickname is filled in, the app shows it in place of
-- the first name (youth) or of the full name (leaders); the record keeps the
-- legal name for forms, health records and official documents.
--
-- A youth's nickname is set by the unit's leaders (participants.edit); a
-- leader sets their own from their account.

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS nickname character varying(100);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nickname character varying(100);

COMMENT ON COLUMN public.participants.nickname IS
  'Name the youth goes by in the unit, shown in place of the first name when filled in. NULL when none.';
COMMENT ON COLUMN public.users.nickname IS
  'Name the member goes by in the unit (a leader''s totem name), shown in place of the full name when filled in. NULL when none.';
