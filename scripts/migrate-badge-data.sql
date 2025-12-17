-- Data Migration: Split existing multi-star entries into individual level entries
-- Run this AFTER the badge_templates migration if you have existing data

-- This is a helper script to migrate existing data into per-level badge_progress rows.
-- WARNING: Review your data first before running!

DO $$
DECLARE
    badge_record RECORD;
    star_num INTEGER;
BEGIN
    -- Find all badges with multiple stars (legacy quantity style)
    FOR badge_record IN
        SELECT bp.*, bt.level_count
        FROM badge_progress bp
        JOIN badge_templates bt ON bp.badge_template_id = bt.id
        WHERE bp.etoiles > 1
    LOOP
        -- Create individual entries for each star (2 through etoiles) up to the template's level_count
        FOR star_num IN 2..LEAST(badge_record.etoiles, COALESCE(badge_record.level_count, badge_record.etoiles)) LOOP
            INSERT INTO badge_progress (
                participant_id, organization_id, badge_template_id, territoire_chasse, section,
                objectif, description, fierte, raison, date_obtention, etoiles,
                created_at, status, approved_by, approval_date
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

        -- Update original entry to be star 1
        UPDATE badge_progress 
        SET etoiles = 1 
        WHERE id = badge_record.id;
    END LOOP;
END $$;
