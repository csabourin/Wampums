-- Data Migration: Split existing multi-star entries into individual star entries
-- Run this AFTER the structure migration if you have existing data

-- This is a helper script to migrate existing data
-- WARNING: Review your data first before running!

-- Example migration (customize based on your data):
-- For each entry with etoiles > 1, create separate entries for each star
-- This is just a template - adjust based on your actual data needs

DO $$
DECLARE
    badge_record RECORD;
    star_num INTEGER;
BEGIN
    -- Find all badges with multiple stars
    FOR badge_record IN 
        SELECT * FROM badge_progress WHERE etoiles > 1
    LOOP
        -- Create individual entries for each star (2 through etoiles)
        FOR star_num IN 2..badge_record.etoiles LOOP
            INSERT INTO badge_progress (
                participant_id, territoire_chasse, objectif, description,
                fierte, raison, date_obtention, etoiles,
                created_at, status, approved_by, approval_date, organization_id
            ) VALUES (
                badge_record.participant_id,
                badge_record.territoire_chasse,
                badge_record.objectif,
                badge_record.description,
                badge_record.fierte,
                badge_record.raison,
                badge_record.date_obtention,
                star_num, -- Individual star number
                badge_record.created_at,
                badge_record.status,
                badge_record.approved_by,
                badge_record.approval_date,
                badge_record.organization_id
            );
        END LOOP;
        
        -- Update original entry to be star 1
        UPDATE badge_progress 
        SET etoiles = 1 
        WHERE id = badge_record.id;
    END LOOP;
END $$;
