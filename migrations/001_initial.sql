-- 001_initial.sql
--
-- Generalises fundraising campaigns beyond "unit count x fixed price".
--
-- Before this migration a campaign could only be expressed through
-- fundraiser_entries.amount, an INTEGER column that in practice stored a number
-- of units sold (calendars), not a monetary value. Campaigns based on donations,
-- variable prices, deposit-return containers or worked hours could not be
-- represented at all.
--
-- Compatibility with existing data:
--   * No column is dropped, renamed or retyped. fundraiser_entries.amount keeps
--     its legacy meaning (unit count) for campaigns created before this change.
--   * Existing campaigns are backfilled to campaign_type = 'fixed_price_sale',
--     which is exactly the behaviour they had.
--   * fundraiser_entries.quantity is backfilled from the legacy amount column so
--     new code can read a single, well-named field for unit counts.
--   * unit_price stays NULL for legacy campaigns; the money resolution logic
--     falls back to the legacy amount column when no unit price is known, so no
--     historical total changes.

-- ---------------------------------------------------------------------------
-- Campaign level: how is money raised, and what does one unit cost?
-- ---------------------------------------------------------------------------
ALTER TABLE public.fundraisers
  ADD COLUMN IF NOT EXISTS campaign_type text NOT NULL DEFAULT 'fixed_price_sale',
  ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS unit_label text;

COMMENT ON COLUMN public.fundraisers.campaign_type IS
  'How entry values are turned into money: fixed_price_sale, variable_price_sale, container_deposit, hours_worked, direct_amount, donation, sponsored_activity, other';
COMMENT ON COLUMN public.fundraisers.unit_price IS
  'Money per unit (fixed_price_sale, container_deposit) or per hour (hours_worked). NULL when the campaign has no unit price.';
COMMENT ON COLUMN public.fundraisers.unit_label IS
  'Human label for one unit, e.g. "calendriers", "contenants". Optional.';

ALTER TABLE public.fundraisers
  DROP CONSTRAINT IF EXISTS fundraisers_campaign_type_check;

ALTER TABLE public.fundraisers
  ADD CONSTRAINT fundraisers_campaign_type_check
  CHECK (campaign_type IN (
    'fixed_price_sale',
    'variable_price_sale',
    'container_deposit',
    'hours_worked',
    'direct_amount',
    'donation',
    'sponsored_activity',
    'other'
  ));

ALTER TABLE public.fundraisers
  DROP CONSTRAINT IF EXISTS fundraisers_unit_price_non_negative;

ALTER TABLE public.fundraisers
  ADD CONSTRAINT fundraisers_unit_price_non_negative
  CHECK (unit_price IS NULL OR unit_price >= 0);

-- ---------------------------------------------------------------------------
-- Entry level: the measures a campaign can record for one participant.
-- Every column is nullable: a campaign only fills the ones it actually uses.
-- ---------------------------------------------------------------------------
ALTER TABLE public.fundraiser_entries
  ADD COLUMN IF NOT EXISTS quantity numeric(12, 2),
  ADD COLUMN IF NOT EXISTS hours numeric(8, 2),
  ADD COLUMN IF NOT EXISTS amount_raised numeric(12, 2);

COMMENT ON COLUMN public.fundraiser_entries.quantity IS
  'Number of units credited to this participant (items sold, containers collected). NULL when the campaign is not unit based.';
COMMENT ON COLUMN public.fundraiser_entries.hours IS
  'Hours worked by this participant. NULL unless the campaign is hours based.';
COMMENT ON COLUMN public.fundraiser_entries.amount_raised IS
  'Money raised by this participant, entered directly. Takes precedence over quantity/hours x unit_price.';
COMMENT ON COLUMN public.fundraiser_entries.amount IS
  'Legacy unit count kept for backwards compatibility. New code reads quantity and amount_raised instead.';

ALTER TABLE public.fundraiser_entries
  DROP CONSTRAINT IF EXISTS fundraiser_entries_measures_non_negative;

ALTER TABLE public.fundraiser_entries
  ADD CONSTRAINT fundraiser_entries_measures_non_negative
  CHECK (
    (quantity IS NULL OR quantity >= 0)
    AND (hours IS NULL OR hours >= 0)
    AND (amount_raised IS NULL OR amount_raised >= 0)
  );

-- Backfill the legacy unit count into the explicitly named column.
UPDATE public.fundraiser_entries
   SET quantity = amount
 WHERE quantity IS NULL;
