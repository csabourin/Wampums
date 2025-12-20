-- Migration: Rename leader columns in participant_groups table
-- Description: Renames is_leader to first_leader and is_second_leader to second_leader
-- This migration is idempotent and can be run multiple times safely
-- Run After: 004_rename_calendars_to_fundraiser_entries.sql

DO $$
BEGIN
    -- Check if the old columns exist and new columns don't exist
    IF EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'participant_groups'
        AND column_name = 'is_leader'
    ) THEN
        -- Rename is_leader to first_leader
        ALTER TABLE public.participant_groups
            RENAME COLUMN is_leader TO first_leader;

        RAISE NOTICE 'Successfully renamed is_leader to first_leader';
    ELSE
        RAISE NOTICE 'Column is_leader does not exist or first_leader already exists, skipping is_leader rename';
    END IF;

    -- Check if is_second_leader exists
    IF EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'participant_groups'
        AND column_name = 'is_second_leader'
    ) THEN
        -- Rename is_second_leader to second_leader
        ALTER TABLE public.participant_groups
            RENAME COLUMN is_second_leader TO second_leader;

        RAISE NOTICE 'Successfully renamed is_second_leader to second_leader';
    ELSE
        RAISE NOTICE 'Column is_second_leader does not exist or second_leader already exists, skipping is_second_leader rename';
    END IF;
END $$;
