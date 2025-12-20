/**
 * Add structured frequency preset columns for medication requirements and
 * store interval start times as strings to avoid timezone conversions.
 *
 * This replaces the previous ad-hoc SQL migration scripts with a tracked
 * node-pg-migrate step so deployments stay consistent.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE medication_requirements
      ADD COLUMN IF NOT EXISTS frequency_preset_type VARCHAR(30),
      ADD COLUMN IF NOT EXISTS frequency_times JSONB,
      ADD COLUMN IF NOT EXISTS frequency_slots JSONB,
      ADD COLUMN IF NOT EXISTS frequency_interval_hours INTEGER,
      ADD COLUMN IF NOT EXISTS frequency_interval_start VARCHAR(5);
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'medication_requirements'
          AND column_name = 'frequency_interval_start'
          AND data_type = 'time without time zone'
      ) THEN
        ALTER TABLE medication_requirements
          ALTER COLUMN frequency_interval_start TYPE VARCHAR(5)
          USING to_char(frequency_interval_start, 'HH24:MI');
      END IF;
    END $$;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_medication_requirements_frequency_type
      ON medication_requirements (frequency_preset_type);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_medication_requirements_frequency_type;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'medication_requirements'
          AND column_name = 'frequency_interval_start'
          AND data_type <> 'time without time zone'
      ) THEN
        ALTER TABLE medication_requirements
          ALTER COLUMN frequency_interval_start TYPE TIME
          USING CASE
            WHEN frequency_interval_start ~ '^[0-2][0-9]:[0-5][0-9]$'
              THEN frequency_interval_start::time
            ELSE NULL
          END;
      END IF;
    END $$;
  `);

  pgm.sql(`
    ALTER TABLE medication_requirements
      DROP COLUMN IF EXISTS frequency_preset_type,
      DROP COLUMN IF EXISTS frequency_times,
      DROP COLUMN IF EXISTS frequency_slots,
      DROP COLUMN IF EXISTS frequency_interval_hours,
      DROP COLUMN IF EXISTS frequency_interval_start;
  `);
};
