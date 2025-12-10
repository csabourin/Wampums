-- Equipment inventory and permission slips
-- Provides multi-tenant tables for resource scheduling and guardian approvals

CREATE TABLE IF NOT EXISTS public.equipment_items (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(100),
  description TEXT,
  quantity_total INTEGER NOT NULL DEFAULT 1 CHECK (quantity_total >= 0),
  quantity_available INTEGER NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  condition_note TEXT,
  is_active BOOLEAN DEFAULT true,
  attributes JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_equipment_items_org
  ON public.equipment_items(organization_id);

-- Equipment access control to allow shared inventories between organizations
CREATE TABLE IF NOT EXISTS public.equipment_item_organizations (
  equipment_id INTEGER NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (equipment_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_item_org_org
  ON public.equipment_item_organizations(organization_id);

-- Reservations by meeting date (linked to reunion_preparations when provided)
CREATE TABLE IF NOT EXISTS public.equipment_reservations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES reunion_preparations(id) ON DELETE SET NULL,
  meeting_date DATE NOT NULL,
  reserved_quantity INTEGER NOT NULL DEFAULT 1 CHECK (reserved_quantity > 0),
  reserved_for VARCHAR(200) NOT NULL DEFAULT '',
  status VARCHAR(20) DEFAULT 'reserved' CHECK (status IN ('reserved', 'confirmed', 'returned', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_equipment_reservations_org_date
  ON public.equipment_reservations(organization_id, meeting_date);

CREATE INDEX IF NOT EXISTS idx_equipment_reservations_status
  ON public.equipment_reservations(status);

ALTER TABLE public.equipment_reservations
  ADD CONSTRAINT equipment_reservations_unique_reservation
  UNIQUE (organization_id, equipment_id, meeting_date, reserved_for);

-- Digital permission slips tied to participants and meetings
CREATE TABLE IF NOT EXISTS public.permission_slips (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  guardian_id INTEGER REFERENCES parents_guardians(id),
  meeting_id INTEGER REFERENCES reunion_preparations(id) ON DELETE SET NULL,
  meeting_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'revoked', 'expired')),
  consent_payload JSONB DEFAULT '{}'::jsonb,
  signed_at TIMESTAMP WITH TIME ZONE,
  signed_by TEXT,
  signature_hash TEXT,
  contact_confirmation JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, participant_id, meeting_date)
);

CREATE INDEX IF NOT EXISTS idx_permission_slips_org_date
  ON public.permission_slips(organization_id, meeting_date);

CREATE INDEX IF NOT EXISTS idx_permission_slips_status
  ON public.permission_slips(status);

-- Default organization-level templates (organizations 0 and 1)
INSERT INTO organization_settings (organization_id, setting_key, setting_value)
SELECT org_id, 'permission_slip_defaults',
       '{"requires_signature":true,"reminder_days":3,"fields":["medical","emergency_contact","pickup_authorization"]}'::jsonb
FROM (VALUES (0), (1)) AS orgs(org_id)
WHERE NOT EXISTS (
  SELECT 1 FROM organization_settings s
  WHERE s.organization_id = org_id AND s.setting_key = 'permission_slip_defaults'
);

INSERT INTO organization_settings (organization_id, setting_key, setting_value)
SELECT org_id, 'equipment_categories', '{"categories":["safety","games","camping","documentation"]}'::jsonb
FROM (VALUES (0), (1)) AS orgs(org_id)
WHERE NOT EXISTS (
  SELECT 1 FROM organization_settings s
  WHERE s.organization_id = org_id AND s.setting_key = 'equipment_categories'
);

INSERT INTO equipment_items (organization_id, name, category, description, quantity_total, quantity_available, condition_note, attributes)
SELECT org_id, name, category, description, qty, qty,
       'Initial inventory template', '{}'
FROM (
  VALUES
    (0, 'First Aid Kit', 'safety', 'Comprehensive first aid backpack', 3),
    (0, 'Camp Stove', 'camping', 'Portable propane stove with regulator', 2),
    (0, 'Projector', 'documentation', 'HDMI-enabled projector for training nights', 1)
) AS seed(org_id, name, category, description, qty)
WHERE NOT EXISTS (
  SELECT 1 FROM equipment_items e
  WHERE e.organization_id = seed.org_id AND e.name = seed.name
);

-- Default access: owners and shared access for organization 1 to template inventory (0)
INSERT INTO equipment_item_organizations (equipment_id, organization_id)
SELECT e.id, e.organization_id FROM equipment_items e
ON CONFLICT DO NOTHING;

INSERT INTO equipment_item_organizations (equipment_id, organization_id)
SELECT e.id, 1
FROM equipment_items e
WHERE e.organization_id = 0
ON CONFLICT DO NOTHING;
