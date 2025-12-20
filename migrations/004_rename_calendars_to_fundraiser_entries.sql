-- Migration: Rename calendars table to fundraiser_entries
-- Description: Renames the calendars table to fundraiser_entries for better clarity
-- This migration is idempotent and can be run multiple times safely
-- Run After: All existing migrations

DO $$
BEGIN
    -- Check if calendars table exists and fundraiser_entries does not exist
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'calendars')
       AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fundraiser_entries')
    THEN
        -- Rename the table
        ALTER TABLE public.calendars RENAME TO fundraiser_entries;

        -- Rename the primary key constraint
        ALTER TABLE public.fundraiser_entries
            RENAME CONSTRAINT calendars_pkey TO fundraiser_entries_pkey;

        -- Rename the foreign key constraints
        ALTER TABLE public.fundraiser_entries
            RENAME CONSTRAINT calendars_fundraiser_fkey TO fundraiser_entries_fundraiser_fkey;

        ALTER TABLE public.fundraiser_entries
            RENAME CONSTRAINT calendars_participant_id_fkey TO fundraiser_entries_participant_id_fkey;

        RAISE NOTICE 'Successfully renamed calendars table to fundraiser_entries';
    ELSIF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fundraiser_entries')
    THEN
        RAISE NOTICE 'fundraiser_entries table already exists, skipping migration';
    ELSE
        RAISE EXCEPTION 'calendars table does not exist, cannot run migration';
    END IF;
END $$;
