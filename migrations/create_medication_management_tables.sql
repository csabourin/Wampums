BEGIN;

-- Medication requirement definitions per organization
CREATE TABLE IF NOT EXISTS medication_requirements (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    medication_name VARCHAR(200) NOT NULL,
    dosage_instructions TEXT,
    frequency_text VARCHAR(120),
    route VARCHAR(120),
    default_dose_amount NUMERIC(10,2),
    default_dose_unit VARCHAR(50),
    general_notes TEXT,
    start_date DATE,
    end_date DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, medication_name, COALESCE(start_date, '0001-01-01'::date))
);

CREATE INDEX IF NOT EXISTS idx_medication_requirements_org
    ON medication_requirements (organization_id);

-- Participant-specific assignments and notes for medications
CREATE TABLE IF NOT EXISTS participant_medications (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    medication_requirement_id INTEGER NOT NULL REFERENCES medication_requirements(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    participant_notes TEXT,
    custom_dosage TEXT,
    custom_frequency TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, medication_requirement_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_participant_medications_org_participant
    ON participant_medications (organization_id, participant_id);

-- Distribution log capturing scheduled and administered doses
CREATE TABLE IF NOT EXISTS medication_distributions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    medication_requirement_id INTEGER NOT NULL REFERENCES medication_requirements(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    participant_medication_id INTEGER REFERENCES participant_medications(id) ON DELETE SET NULL,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    activity_name VARCHAR(200),
    dose_amount NUMERIC(10,2),
    dose_unit VARCHAR(50),
    dose_notes TEXT,
    general_notice TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'given', 'missed', 'cancelled')),
    administered_at TIMESTAMP WITH TIME ZONE,
    administered_by UUID REFERENCES users(id),
    witness_name VARCHAR(150),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, medication_requirement_id, participant_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_medication_distributions_schedule
    ON medication_distributions (organization_id, scheduled_for);

COMMIT;
