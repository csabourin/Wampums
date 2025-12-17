-- Create carpool_assignments table for tracking participant assignments to vehicles
-- Migration: create_carpool_assignments_table

CREATE TABLE IF NOT EXISTS carpool_assignments (
  id SERIAL PRIMARY KEY,
  carpool_offer_id INTEGER NOT NULL REFERENCES carpool_offers(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Trip direction for this specific assignment: 'both' | 'to_activity' | 'from_activity'
  trip_direction VARCHAR(20) NOT NULL CHECK (trip_direction IN ('both', 'to_activity', 'from_activity')),

  -- Seat position information
  notes TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Prevent duplicate assignments: same participant can't be assigned to same offer with overlapping directions
  CONSTRAINT unique_participant_offer UNIQUE (carpool_offer_id, participant_id, trip_direction)
);

-- Indexes for performance
CREATE INDEX idx_carpool_assignments_offer ON carpool_assignments(carpool_offer_id);
CREATE INDEX idx_carpool_assignments_participant ON carpool_assignments(participant_id);
CREATE INDEX idx_carpool_assignments_assigned_by ON carpool_assignments(assigned_by);
CREATE INDEX idx_carpool_assignments_organization ON carpool_assignments(organization_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_carpool_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER carpool_assignments_updated_at_trigger
BEFORE UPDATE ON carpool_assignments
FOR EACH ROW
EXECUTE FUNCTION update_carpool_assignments_updated_at();

-- Function to check seat availability before assignment
CREATE OR REPLACE FUNCTION check_carpool_seat_availability()
RETURNS TRIGGER AS $$
DECLARE
  v_total_seats INTEGER;
  v_assigned_seats INTEGER;
  v_trip_direction VARCHAR(20);
BEGIN
  -- Get the carpool offer details
  SELECT total_seats_available, trip_direction
  INTO v_total_seats, v_trip_direction
  FROM carpool_offers
  WHERE id = NEW.carpool_offer_id AND is_active = TRUE;

  -- Check if offer exists and is active
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Carpool offer not found or is not active';
  END IF;

  -- Validate trip direction compatibility
  IF v_trip_direction = 'to_activity' AND NEW.trip_direction IN ('from_activity', 'both') THEN
    RAISE EXCEPTION 'Cannot assign % trip to a % only offer', NEW.trip_direction, v_trip_direction;
  END IF;

  IF v_trip_direction = 'from_activity' AND NEW.trip_direction IN ('to_activity', 'both') THEN
    RAISE EXCEPTION 'Cannot assign % trip to a % only offer', NEW.trip_direction, v_trip_direction;
  END IF;

  -- Count current assignments for the relevant direction(s)
  SELECT COUNT(DISTINCT participant_id)
  INTO v_assigned_seats
  FROM carpool_assignments
  WHERE carpool_offer_id = NEW.carpool_offer_id
    AND id != COALESCE(NEW.id, -1)  -- Exclude current record if updating
    AND (
      (NEW.trip_direction = 'both' AND trip_direction IN ('both', 'to_activity', 'from_activity'))
      OR (NEW.trip_direction = 'to_activity' AND trip_direction IN ('both', 'to_activity'))
      OR (NEW.trip_direction = 'from_activity' AND trip_direction IN ('both', 'from_activity'))
    );

  -- Check if there are available seats
  IF v_assigned_seats >= v_total_seats THEN
    RAISE EXCEPTION 'No available seats in this carpool offer (% of % seats used)', v_assigned_seats, v_total_seats;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_carpool_seat_availability_trigger
BEFORE INSERT OR UPDATE ON carpool_assignments
FOR EACH ROW
EXECUTE FUNCTION check_carpool_seat_availability();

COMMENT ON TABLE carpool_assignments IS 'Assignments of participants to carpool vehicles';
COMMENT ON COLUMN carpool_assignments.trip_direction IS 'Which part of trip this assignment covers: both, to_activity, or from_activity';
COMMENT ON COLUMN carpool_assignments.assigned_by IS 'User who made this assignment (parent or animation staff)';
