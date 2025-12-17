-- Create activities table for event management and carpooling coordination
-- Migration: create_activities_table

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Activity details
  name VARCHAR(255) NOT NULL,
  description TEXT,
  activity_date DATE NOT NULL,

  -- Going to activity
  meeting_location_going TEXT NOT NULL,
  meeting_time_going TIME NOT NULL,
  departure_time_going TIME NOT NULL,

  -- Returning from activity
  meeting_location_return TEXT,
  meeting_time_return TIME,
  departure_time_return TIME,

  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_going_times CHECK (departure_time_going >= meeting_time_going)
);

-- Index for performance
CREATE INDEX idx_activities_organization ON activities(organization_id);
CREATE INDEX idx_activities_date ON activities(activity_date);
CREATE INDEX idx_activities_active ON activities(is_active);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_activities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activities_updated_at_trigger
BEFORE UPDATE ON activities
FOR EACH ROW
EXECUTE FUNCTION update_activities_updated_at();

COMMENT ON TABLE activities IS 'Calendar of activities/events for organizations';
COMMENT ON COLUMN activities.meeting_location_going IS 'Meeting point before departure to activity';
COMMENT ON COLUMN activities.meeting_time_going IS 'Time to meet before going to activity';
COMMENT ON COLUMN activities.departure_time_going IS 'Time when carpools depart to activity';
COMMENT ON COLUMN activities.meeting_location_return IS 'Meeting point for return journey';
COMMENT ON COLUMN activities.meeting_time_return IS 'Time to meet for return trip';
COMMENT ON COLUMN activities.departure_time_return IS 'Time when carpools depart on return';
