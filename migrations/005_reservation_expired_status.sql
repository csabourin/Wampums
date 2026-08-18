-- Reservations that lapsed without being taken
--
-- `reserved` means the gear was spoken for, not that it left the shelf; only
-- `confirmed` says someone actually took it. So a reservation whose last day has
-- passed while still merely `reserved` was never collected, and the equipment it
-- was holding has been available all along.
--
-- Two queries -- the availability sum and the delete guard -- counted those rows
-- forever, because they filtered on status without ever looking at the date. One
-- item ended up with six units held by reservations from December against a stock
-- of two, which made it permanently unbookable.
--
-- `expired` names that state honestly. It is deliberately not `returned`: nobody
-- checked this gear back in, and recording that they had would erase the
-- difference between kit that came home and kit that never went out.

ALTER TABLE public.equipment_reservations
  DROP CONSTRAINT IF EXISTS equipment_reservations_status_check;

ALTER TABLE public.equipment_reservations
  ADD CONSTRAINT equipment_reservations_status_check
  CHECK (status::text = ANY (ARRAY[
    'reserved'::character varying,
    'confirmed'::character varying,
    'returned'::character varying,
    'cancelled'::character varying,
    'expired'::character varying
  ]::text[]));

-- Close out the rows that are already past. `confirmed` is left alone on purpose:
-- that equipment did go out, and whether it came back is a question for whoever
-- checks it in, not one this migration may answer.
UPDATE public.equipment_reservations
   SET status = 'expired',
       updated_at = CURRENT_TIMESTAMP
 WHERE status = 'reserved'
   AND COALESCE(date_to, meeting_date) < CURRENT_DATE;

-- The expiry sweep runs on every reservation listing, so it must stay cheap.
CREATE INDEX IF NOT EXISTS idx_equipment_reservations_lapsed
  ON public.equipment_reservations (organization_id)
  WHERE status = 'reserved';
