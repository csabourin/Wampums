-- Add location metadata to equipment items for pickup context
ALTER TABLE equipment_items
  ADD COLUMN IF NOT EXISTS location_type VARCHAR(50) NOT NULL DEFAULT 'local_scout_hall' CHECK (location_type IN ('local_scout_hall', 'warehouse', 'leader_home', 'other')),
  ADD COLUMN IF NOT EXISTS location_details VARCHAR(500) DEFAULT '';

-- Ensure shared equipment views include location metadata for consumers relying on materialized views
CREATE OR REPLACE VIEW equipment_item_organizations_view AS
SELECT
  eio.equipment_id,
  eio.organization_id,
  ei.name,
  ei.category,
  ei.location_type,
  ei.location_details,
  ei.quantity_total,
  ei.quantity_available,
  ei.is_active,
  ei.photo_url,
  ei.item_value,
  ei.acquisition_date
FROM equipment_item_organizations eio
JOIN equipment_items ei ON ei.id = eio.equipment_id;
