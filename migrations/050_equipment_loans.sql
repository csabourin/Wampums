-- Equipment loans: who has which equipment at home right now (tents and tarps
-- taken home to dry after a camp, a stove lent for a weekend).
--
-- A reservation plans the use of equipment; a loan records who holds it. One
-- reservation may be split between several holders, and a loan may exist
-- without any reservation. The holder is a youth of the unit (their family
-- takes it home) or an adult member. Erasing either keeps the loan, without a
-- holder, so the unit still knows the equipment has not come back.
CREATE TABLE IF NOT EXISTS equipment_loans (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL,
  holder_participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  holder_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0,
  reason VARCHAR(20) NOT NULL DEFAULT 'drying'
    CHECK (reason IN ('drying', 'cleaning', 'repair', 'storage', 'other')),
  loaned_on DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  returned_at TIMESTAMPTZ,
  notes VARCHAR(500),
  return_note VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  returned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT equipment_loans_one_holder
    CHECK (num_nonnulls(holder_participant_id, holder_user_id) <= 1),
  CONSTRAINT equipment_loans_returned_range
    CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
  CONSTRAINT equipment_loans_due_after_loan
    CHECK (due_date IS NULL OR due_date >= loaned_on),
  CONSTRAINT equipment_loans_returned_at_when_complete
    CHECK ((returned_at IS NOT NULL) = (returned_quantity = quantity))
);

COMMENT ON TABLE equipment_loans IS
  'Equipment a unit member holds outside storage. Open while returned_quantity < quantity.';
COMMENT ON COLUMN equipment_loans.holder_participant_id IS
  'Youth holding the equipment (their family). NULL with holder_user_id NULL once the holder was erased.';
COMMENT ON COLUMN equipment_loans.returned_quantity IS
  'How many have come back. The loan closes (returned_at set) when it equals quantity.';

CREATE INDEX IF NOT EXISTS idx_equipment_loans_open
  ON equipment_loans (organization_id, equipment_id)
  WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_loans_equipment_open
  ON equipment_loans (equipment_id)
  WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_loans_activity
  ON equipment_loans (organization_id, activity_id);

-- Offline handouts at the end of a camp replay with an Idempotency-Key: the
-- receipt commits with the loans, so a lost response never lends twice.
-- response_data holds only the loan ids ({"loan_ids": [...]}): a replay reads
-- the loans as they are now, so no name outlives an erasure here.
CREATE TABLE IF NOT EXISTS equipment_loan_receipts (
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_key VARCHAR(128) NOT NULL,
  request_hash TEXT NOT NULL,
  response_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id, mutation_key)
);

-- Units of an item still out on loan that can be counted on for a use starting
-- on p_from: every open loan, unless it is due back before that day and not yet
-- overdue. Loans of every unit count, as reservations of every unit do. Loans
-- made for p_activity_id are that activity's own reservation leaving the shelf,
-- so a check of that reservation leaves them out.
DROP FUNCTION IF EXISTS equipment_loaned_quantity(INTEGER, DATE);
CREATE OR REPLACE FUNCTION equipment_loaned_quantity(p_equipment_id INTEGER, p_from DATE, p_activity_id INTEGER DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(quantity - returned_quantity), 0)::integer
    FROM equipment_loans
   WHERE equipment_id = p_equipment_id
     AND returned_at IS NULL
     AND (due_date IS NULL OR due_date >= p_from OR due_date < CURRENT_DATE)
     AND (p_activity_id IS NULL OR activity_id IS DISTINCT FROM p_activity_id);
$$;

-- What loans add to the reservations a reservation check already sums, over
-- p_from..p_to: a loan made for an activity is that activity's reservation
-- leaving the shelf, so each activity counts only the loans beyond what its
-- own overlapping reservations hold (the larger of the two, never both).
-- Loans without an activity count in full. Loans of p_activity_id are the
-- reservation being checked leaving the shelf, and p_except_reservation_id is
-- that reservation, left out of what its activity is taken to hold.
CREATE OR REPLACE FUNCTION equipment_loans_beyond_reservations(
  p_equipment_id INTEGER,
  p_from DATE,
  p_to DATE,
  p_activity_id INTEGER DEFAULT NULL,
  p_except_reservation_id INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(GREATEST(0, loans.outstanding - COALESCE((
           SELECT SUM(r.reserved_quantity)
             FROM equipment_reservations r
            WHERE loans.activity_id IS NOT NULL
              AND r.activity_id = loans.activity_id
              AND r.equipment_id = p_equipment_id
              AND r.status IN ('reserved', 'confirmed')
              AND COALESCE(r.date_from, r.meeting_date) <= p_to
              AND COALESCE(r.date_to, r.meeting_date) >= p_from
              AND (p_except_reservation_id IS NULL OR r.id <> p_except_reservation_id)
         ), 0))), 0)::integer
    FROM (
      SELECT activity_id, SUM(quantity - returned_quantity) AS outstanding
        FROM equipment_loans
       WHERE equipment_id = p_equipment_id
         AND returned_at IS NULL
         AND (due_date IS NULL OR due_date >= p_from OR due_date < CURRENT_DATE)
         AND (p_activity_id IS NULL OR activity_id IS DISTINCT FROM p_activity_id)
       GROUP BY activity_id
    ) AS loans;
$$;
