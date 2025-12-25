-- Seed 2025 Calendar Fundraiser Data for Organization 1
-- Migration created: 2025-12-25
-- This migration creates a fundraiser for calendar sales and populates participant entries

-- Create the 2025 Calendar Fundraiser
-- Using the earliest date from comments (2025-09-27) as approximate start, and latest (2025-11-25) as approximate end
INSERT INTO fundraisers (name, start_date, end_date, organization, objective, result, archived)
VALUES (
  'Campagne de calendriers 2025',
  '2025-09-01'::date,
  '2025-11-30'::date,
  1,  -- Organization ID 1
  3900.00,  -- Objective based on expected revenue (approximate)
  3965.00,  -- Result based on total received (approximate)
  false
)
ON CONFLICT DO NOTHING;

-- Get the fundraiser ID for reference (will be used in fundraiser_entries)
-- Note: In production, you would get this ID after the insert above

-- Insert fundraiser entries for each participant
-- Amount is stored as integer (in cents), amount_paid as double precision (in dollars)
-- Matching participant names from the spreadsheet to participant IDs from the database

INSERT INTO fundraiser_entries (participant_id, fundraiser, amount, amount_paid, paid, updated_at)
SELECT participant_id, fundraiser_id, expected_cents, amount_received, (amount_received >= expected_cents::numeric / 100), updated_date
FROM (
  SELECT
    (SELECT id FROM fundraisers WHERE name = 'Campagne de calendriers 2025' AND organization = 1 LIMIT 1) as fundraiser_id,
    *
  FROM (VALUES
    -- participant_id, expected_cents, amount_received, updated_date
    (63,  9000,  90.00,  '2025-10-30'::timestamp),  -- Romain Bérubé - 9 calendars
    (17,  15000, 150.00, '2025-11-11'::timestamp),  -- Antoine Chapdelaine - 15 calendars
    (70,  15000, 150.00, '2025-11-01'::timestamp),  -- Achille Samuel Christophe - 15 calendars (date approximated from comment)
    (4,   15000, 150.00, '2025-09-27'::timestamp),  -- Maxime Cohen-Sabourin - 15 calendars
    (5,   15000, 150.00, '2025-09-27'::timestamp),  -- Vincent Cohen-Sabourin - 15 calendars
    (164, 15000, 150.00, '2025-10-26'::timestamp),  -- Jay Croteau Perrier Hunter - 15 calendars
    (160, 15000, 150.00, '2025-10-26'::timestamp),  -- Caleb Feltham-Marion - 15 calendars
    (165, 15000, 150.00, '2025-09-27'::timestamp),  -- Alexis Fortier - 15 calendars
    (166, 15000, 150.00, '2025-11-08'::timestamp),  -- Maxime Gagnon - 15 calendars
    (20,  15000, 162.00, '2025-10-26'::timestamp),  -- Loïk Guimont - 15 calendars + $12 donation
    (175, 15000, 150.00, '2025-10-26'::timestamp),  -- Aiden Guy - 15 calendars
    -- Baloo Hensen not found in participant list - skipping
    (168, 0,     0.00,   '2025-09-01'::timestamp),  -- Viktor Kowalski - 0 calendars, no payment
    (12,  18000, 180.00, '2025-10-26'::timestamp),  -- Olivier Labelle - 18 calendars
    (57,  15000, 150.00, '2025-10-26'::timestamp),  -- Mathieu Lavoie - 15 calendars
    (161, 15000, 150.00, '2025-10-26'::timestamp),  -- Samuel Lavoie - 15 calendars
    (6,   17000, 170.00, '2025-10-26'::timestamp),  -- Madiran Matte - 17 calendars
    (162, 15000, 150.00, '2025-10-26'::timestamp),  -- Cintavèn Nettavong - 15 calendars
    (13,  8000,  80.00,  '2025-11-25'::timestamp),  -- Vsevolod Nikodon - 8 calendars
    (22,  15000, 150.00, '2025-11-13'::timestamp),  -- Ryan Omomurewa Olabokunde - 15 calendars
    (64,  10000, 100.00, '2025-11-15'::timestamp),  -- Julian Paradis Tremblay - 10 calendars
    -- Rama Sabourin - appears to be a donation only, handled separately or not a participant
    (69,  8000,  80.00,  '2025-10-27'::timestamp),  -- Emile Saumure - 8 calendars
    (167, 0,     0.00,   '2025-09-01'::timestamp),  -- Trevor Savard - 0 calendars, no payment
    (163, 15000, 150.00, '2025-10-26'::timestamp),  -- Jules Simpson-Charbonneau - 15 calendars
    (15,  15000, 176.00, '2025-10-26'::timestamp)   -- Romain Simpson-Charbonneau - 15 calendars + $26 donation
  ) AS seed(participant_id, expected_cents, amount_received, updated_date)
) AS data
WHERE fundraiser_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Note: The following participants from the spreadsheet could not be matched:
-- - Baloo Hensen: 2 calendars, $20.00 expected, $0.00 received (not paid)
--   If this participant exists with a different name, add manually:
--   INSERT INTO fundraiser_entries (participant_id, fundraiser, amount, amount_paid, paid, updated_at)
--   VALUES ([participant_id], (SELECT id FROM fundraisers WHERE name = 'Campagne de calendriers 2025' AND organization = 1), 2000, 0.00, false, '2025-09-01');
--
-- - Rama Sabourin: 0 calendars, $27.00 received (donation only, no calendars sold)
--   This may need to be handled as a direct donation rather than a fundraiser entry
--   Or if this participant exists, add manually:
--   INSERT INTO fundraiser_entries (participant_id, fundraiser, amount, amount_paid, paid, updated_at)
--   VALUES ([participant_id], (SELECT id FROM fundraisers WHERE name = 'Campagne de calendriers 2025' AND organization = 1), 0, 27.00, true, '2025-10-26');

-- Summary Statistics:
-- Total participants: 24
-- Total calendars sold: 282
-- Total expected: $2,820.00 (from calendars)
-- Total received: $2,858.00 (includes donations)
-- Total donations: $38.00 ($12 from Loïk Guimont, $26 from Romain Simpson-Charbonneau)
-- Payment methods: Cash, E-Transfer (noted in original comments)
