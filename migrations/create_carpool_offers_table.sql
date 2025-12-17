-- Create carpool_offers table for ride sharing coordination
-- Migration: create_carpool_offers_table

CREATE TABLE IF NOT EXISTS carpool_offers (
  id SERIAL PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Vehicle information
  vehicle_make VARCHAR(100) NOT NULL,
  vehicle_color VARCHAR(50) NOT NULL,

  -- Capacity information
  total_seats_available INTEGER NOT NULL CHECK (total_seats_available > 0 AND total_seats_available <= 8),

  -- Trip direction: 'both' | 'to_activity' | 'from_activity'
  trip_direction VARCHAR(20) NOT NULL CHECK (trip_direction IN ('both', 'to_activity', 'from_activity')),

  -- Additional information
  notes TEXT,

  -- Status management
  is_active BOOLEAN DEFAULT TRUE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancelled_reason TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT positive_seats CHECK (total_seats_available > 0)
);

-- Indexes for performance
CREATE INDEX idx_carpool_offers_activity ON carpool_offers(activity_id);
CREATE INDEX idx_carpool_offers_user ON carpool_offers(user_id);
CREATE INDEX idx_carpool_offers_organization ON carpool_offers(organization_id);
CREATE INDEX idx_carpool_offers_active ON carpool_offers(is_active);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_carpool_offers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER carpool_offers_updated_at_trigger
BEFORE UPDATE ON carpool_offers
FOR EACH ROW
EXECUTE FUNCTION update_carpool_offers_updated_at();

COMMENT ON TABLE carpool_offers IS 'Carpool ride offers from parents and animation staff';
COMMENT ON COLUMN carpool_offers.total_seats_available IS 'Total seats available excluding driver. Front seat should only be used by driver own child if local laws allow';
COMMENT ON COLUMN carpool_offers.trip_direction IS 'Direction of ride: both (round trip), to_activity (one-way to), from_activity (one-way from)';
COMMENT ON COLUMN carpool_offers.is_active IS 'Whether this ride offer is still available';
COMMENT ON COLUMN carpool_offers.cancelled_reason IS 'Reason provided when ride is cancelled';
