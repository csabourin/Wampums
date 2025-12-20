-- Migration: Normalize badge_progress entries to per-level rows
-- Description: Splits legacy multi-star badge_progress records into one row per level
-- Run After: badge_templates migration that introduces level_count for multi-level badges
-- Notes: Idempotent for existing data—new rows are inserted with ON CONFLICT protections,
--        and the source row is normalized to étoile 1.

DO $$
DECLARE
    badge_record RECORD;
    star_num INTEGER;
BEGIN
    -- Find all badge_progress rows that still store multiple stars in a single record
    FOR badge_record IN
        SELECT bp.*, bt.level_count
        FROM badge_progress bp
        JOIN badge_templates bt ON bp.badge_template_id = bt.id
        WHERE bp.etoiles > 1
    LOOP
        -- Create individual entries for each additional star up to the template's level_count
        FOR star_num IN 2..LEAST(badge_record.etoiles, COALESCE(badge_record.level_count, badge_record.etoiles)) LOOP
            INSERT INTO badge_progress (
                participant_id,
                organization_id,
                badge_template_id,
                territoire_chasse,
                section,
                objectif,
                description,
                fierte,
                raison,
                date_obtention,
                etoiles,
                created_at,
                status,
                approved_by,
                approval_date
            )
            VALUES (
                badge_record.participant_id,
                badge_record.organization_id,
                badge_record.badge_template_id,
                badge_record.territoire_chasse,
                badge_record.section,
                badge_record.objectif,
                badge_record.description,
                badge_record.fierte,
                badge_record.raison,
                badge_record.date_obtention,
                star_num,
                badge_record.created_at,
                badge_record.status,
                badge_record.approved_by,
                badge_record.approval_date
            )
            ON CONFLICT ON CONSTRAINT unique_badge_progress_template DO NOTHING;
        END LOOP;

        -- Normalize the original entry to represent the first level only
        UPDATE badge_progress
        SET etoiles = 1
        WHERE id = badge_record.id
          AND badge_record.etoiles <> 1;
    END LOOP;
END $$;
