-- Rename louveteau_dhonneur to a neutral youth_of_honor field
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reunion_preparations'
      AND column_name = 'louveteau_dhonneur'
  ) THEN
    ALTER TABLE reunion_preparations
    RENAME COLUMN louveteau_dhonneur TO youth_of_honor;
  END IF;
END$$;

-- Seed meeting section defaults so each organization (and the shared org_id=0 defaults)
-- has a configuration for honoree label/required flag and activity templates.
DO $$
DECLARE
  default_config TEXT := $JSON$
{
  "defaultSection": "cubs",
  "sections": {
    "cubs": {
      "honorField": {
        "fieldKey": "youth_of_honor",
        "labelKey": "youth_of_honor_label_cubs",
        "required": false
      },
      "activityTemplates": [
        { "time": "18:45", "duration": "00:10", "activityKey": "activity_welcome_cubs", "typeKey": "activity_type_preparation" },
        { "time": "18:55", "duration": "00:30", "activityKey": "activity_big_game", "typeKey": "activity_type_game" },
        { "time": "19:25", "duration": "00:05", "activityKey": "activity_water_break", "typeKey": "activity_type_pause" },
        { "time": "19:30", "duration": "00:20", "activityKey": "activity_technique", "typeKey": "activity_technique" },
        { "time": "19:50", "duration": "00:20", "activityKey": "activity_discussion", "typeKey": "activity_discussion" },
        { "time": "20:10", "duration": "00:30", "activityKey": "activity_short_game", "typeKey": "activity_type_game" },
        { "time": "20:40", "duration": "00:05", "activityKey": "activity_prayer_departure", "typeKey": "activity_type_conclusion" }
      ]
    }
  }
}
$JSON$;
  org_record RECORD;
BEGIN
  -- Shared defaults (only if a shared organization record exists)
  IF EXISTS (SELECT 1 FROM organizations WHERE id = 0) THEN
    INSERT INTO organization_settings (organization_id, setting_key, setting_value, updated_at)
    VALUES (0, 'meeting_sections', default_config, CURRENT_TIMESTAMP)
    ON CONFLICT (organization_id, setting_key) DO NOTHING;
  END IF;

  -- Initialize defaults for every existing organization
  FOR org_record IN SELECT id FROM organizations LOOP
    INSERT INTO organization_settings (organization_id, setting_key, setting_value, updated_at)
    VALUES (org_record.id, 'meeting_sections', default_config, CURRENT_TIMESTAMP)
    ON CONFLICT (organization_id, setting_key) DO NOTHING;
  END LOOP;
END$$;
