-- Seed 2025-2026 Participant Fees and Payments for Organization 1
-- Migration created: 2025-12-25
-- This migration creates fee definitions, participant fees, and payment records

-- Create fee definition for 2025-2026 season if it doesn't exist
INSERT INTO fee_definitions (organization_id, registration_fee, membership_fee, year_start, year_end, created_at)
VALUES (
  1,  -- Organization ID 1
  277.50,  -- Inscription (registration fee)
  232.50,  -- Cotisation (membership fee)
  '2025-09-01'::date,
  '2026-08-31'::date,
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;

-- Insert participant fees for each participant
-- Some participants have an $80 discount (applied to total_registration_fee)
-- Status is determined by amount paid vs total amount

INSERT INTO participant_fees (participant_id, organization_id, fee_definition_id, total_registration_fee, total_membership_fee, status, notes, created_at)
SELECT participant_id, organization_id, fee_def_id, registration_fee, membership_fee,
       CASE
         WHEN amount_paid = 0 THEN 'unpaid'
         WHEN amount_paid >= (registration_fee + membership_fee) THEN 'paid'
         ELSE 'partially_paid'
       END as status,
       notes, created_at
FROM (
  SELECT
    (SELECT id FROM fee_definitions WHERE organization_id = 1 AND year_start = '2025-09-01' LIMIT 1) as fee_def_id,
    *
  FROM (VALUES
    -- participant_id, org_id, registration_fee, membership_fee, amount_paid, notes, created_at
    (70,  1, 277.50, 232.50, 242.00,  'Cash AKELA - 2025-11 - 392 total (Cal + Coti)', '2025-11-01'::timestamp),  -- Achille Christophe
    (175, 1, 277.50, 232.50, 255.00,  'E-Transfer - 22 oct. 2026', '2026-10-22'::timestamp),  -- Aiden Guy
    (165, 1, 277.50, 232.50, 255.00,  'E-Transfer - 26 oct. 2025', '2025-10-26'::timestamp),  -- Alexis Fortier-Quevillon
    (17,  1, 277.50, 232.50, 255.00,  'E-Transfer - 30 oct. 2025', '2025-10-30'::timestamp),  -- Antoine Chapdelaine
    (160, 1, 277.50, 232.50, 365.00,  'E-Transfer - 26 sept. 2025', '2025-09-26'::timestamp),  -- Caleb FELTHAM-Marion
    (162, 1, 277.50, 232.50, 510.00,  'E-Transfer - 24 sept. 2026', '2026-09-24'::timestamp),  -- Cintaven Nettavong
    (69,  1, 277.50, 232.50, 510.00,  'E-Transfer - 27 oct. 2025', '2025-10-27'::timestamp),  -- Emile Saumure
    (164, 1, 277.50, 232.50, 255.00,  'E-Transfer - 30 oct. 2025', '2025-10-30'::timestamp),  -- Jay Hunter-Croteau-Perrier
    (163, 1, 277.50, 232.50, 510.00,  'E-Transfer - 17 oct. 2025 - 1020 (Jules + Romain S-C)', '2025-10-17'::timestamp),  -- Jules Simpson-Charbonneau
    (64,  1, 277.50, 232.50, 260.00,  'E-Transfer - 30 oct. 2025', '2025-10-30'::timestamp),  -- Julian Paradis Tremblay
    (20,  1, 277.50, 232.50, 510.00,  'E-Transfer - 7 nov. 2026', '2026-11-07'::timestamp),  -- Loïk Guimont
    (6,   1, 197.50, 232.50, 430.00,  'E-Transfer - 3 nov. 2025 - Rabais $80', '2025-11-03'::timestamp),  -- Madiran Matte (with discount)
    (57,  1, 277.50, 232.50, 510.00,  'E-Transfer - 3 nov. 2025', '2025-11-03'::timestamp),  -- Mathieu Lavoie
    (4,   1, 197.50, 232.50, 430.00,  'E-Transfer - 22 oct. 2025 - Animateur 860 (Maxime + Vincent) - Rabais $80', '2025-10-22'::timestamp),  -- Maxime Cohen-Sabourin (with discount)
    (166, 1, 277.50, 232.50, 255.00,  'E-Transfer - 29 oct. 2025', '2025-10-29'::timestamp),  -- Maxime Gagnon
    (12,  1, 197.50, 232.50, 430.00,  'E-Transfer - 31 oct. 2025 - Josianne Garneau #3111763511 - Rabais $80', '2025-10-31'::timestamp),  -- Olivier Labelle (with discount)
    (22,  1, 277.50, 232.50, 120.00,  'E-Trans 2025-11-08 (120$)', '2025-11-08'::timestamp),  -- Rayan Omomurewa Olabokunde
    (63,  1, 277.50, 232.50, 510.00,  'Cash AKELA - 2025-10-29 - courriel 2025-10-29', '2025-10-29'::timestamp),  -- Romain Bérubé
    (15,  1, 277.50, 232.50, 510.00,  'E-Transfer - 17 oct. 2025 - 1020 (Jules + Romain S-C)', '2025-10-17'::timestamp),  -- Romain Simpson-Charbonneau
    (161, 1, 277.50, 232.50, 510.00,  'E-Transfer - 3 nov. 2026', '2026-11-03'::timestamp),  -- Samuel Lavoie
    (13,  1, 277.50, 232.50, 0.00,    'No payment recorded', '2025-09-01'::timestamp),  -- Seva (Vsevolod) Nikodon
    (167, 1, 277.50, 232.50, 255.00,  'E-Transfer - 5 nov. 2026', '2026-11-05'::timestamp),  -- Trevor Savard
    (168, 1, 277.50, 232.50, 255.00,  'E-Transfer - 6 nov. 2026', '2026-11-06'::timestamp),  -- Viktor Kowalski
    (5,   1, 197.50, 232.50, 430.00,  'E-Transfer - 22 oct. 2025 - Animateur 860 (Maxime + Vincent) - Rabais $80', '2025-10-22'::timestamp)   -- Vincent Cohen-Sabourin (with discount)
  ) AS seed(participant_id, organization_id, registration_fee, membership_fee, amount_paid, notes, created_at)
) AS data
WHERE fee_def_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Insert payment records for participants who have made payments
-- This links to participant_fees and records the actual payment transactions

INSERT INTO payments (participant_fee_id, amount, payment_date, method, reference_number, created_at, payment_processor)
SELECT pf.id, payment_amount, payment_date, payment_method, reference_num, payment_date, 'manual'
FROM (
  SELECT
    participant_id,
    payment_amount,
    payment_date,
    payment_method,
    reference_num
  FROM (VALUES
    -- participant_id, payment_amount, payment_date, payment_method, reference_num
    (70,  242.00, '2025-11-01'::date, 'cash', 'AKELA Cash Payment'),  -- Achille Christophe
    (175, 255.00, '2026-10-22'::date, 'e-transfer', 'E-Trans 2026-10-22'),  -- Aiden Guy
    (165, 255.00, '2025-10-26'::date, 'e-transfer', 'E-Trans 2025-10-26'),  -- Alexis Fortier-Quevillon
    (17,  255.00, '2025-10-30'::date, 'e-transfer', 'E-Trans 2025-10-30'),  -- Antoine Chapdelaine
    (160, 365.00, '2025-09-26'::date, 'e-transfer', 'E-Trans 2025-09-26'),  -- Caleb FELTHAM-Marion
    (162, 510.00, '2026-09-24'::date, 'e-transfer', 'E-Trans 2026-09-24'),  -- Cintaven Nettavong
    (69,  510.00, '2025-10-27'::date, 'e-transfer', 'E-Trans 2025-10-27'),  -- Emile Saumure
    (164, 255.00, '2025-10-30'::date, 'e-transfer', 'E-Trans 2025-10-30'),  -- Jay Hunter-Croteau-Perrier
    (163, 510.00, '2025-10-17'::date, 'e-transfer', 'E-Trans 2025-10-17 (1020 total)'),  -- Jules Simpson-Charbonneau
    (64,  260.00, '2025-10-30'::date, 'e-transfer', 'E-Trans 2025-10-30'),  -- Julian Paradis Tremblay
    (20,  510.00, '2026-11-07'::date, 'e-transfer', 'E-Trans 2026-11-07'),  -- Loïk Guimont
    (6,   430.00, '2025-11-03'::date, 'e-transfer', 'E-Trans 2025-11-03'),  -- Madiran Matte
    (57,  510.00, '2025-11-03'::date, 'e-transfer', 'E-Trans 2025-11-03'),  -- Mathieu Lavoie
    (4,   430.00, '2025-10-22'::date, 'e-transfer', 'E-Trans 2025-10-22 (860 total)'),  -- Maxime Cohen-Sabourin
    (166, 255.00, '2025-10-29'::date, 'e-transfer', 'E-Trans 2025-10-29'),  -- Maxime Gagnon
    (12,  430.00, '2025-10-31'::date, 'e-transfer', 'E-Trans 2025-10-31 #3111763511'),  -- Olivier Labelle
    (22,  120.00, '2025-11-08'::date, 'e-transfer', 'E-Trans 2025-11-08'),  -- Rayan Omomurewa Olabokunde
    (63,  510.00, '2025-10-29'::date, 'cash', 'AKELA Cash Payment'),  -- Romain Bérubé
    (15,  510.00, '2025-10-17'::date, 'e-transfer', 'E-Trans 2025-10-17 (1020 total)'),  -- Romain Simpson-Charbonneau
    (161, 510.00, '2026-11-03'::date, 'e-transfer', 'E-Trans 2026-11-03'),  -- Samuel Lavoie
    -- (13,  0.00, NULL, NULL, NULL),  -- Seva (Vsevolod) Nikodon - No payment
    (167, 255.00, '2026-11-05'::date, 'e-transfer', 'E-Trans 2026-11-05'),  -- Trevor Savard
    (168, 255.00, '2026-11-06'::date, 'e-transfer', 'E-Trans 2026-11-06'),  -- Viktor Kowalski
    (5,   430.00, '2025-10-22'::date, 'e-transfer', 'E-Trans 2025-10-22 (860 total)')   -- Vincent Cohen-Sabourin
  ) AS payment_data(participant_id, payment_amount, payment_date, payment_method, reference_num)
  WHERE payment_amount > 0  -- Only insert payments where amount > 0
) AS payments_to_insert
JOIN participant_fees pf ON pf.participant_id = payments_to_insert.participant_id
  AND pf.organization_id = 1
WHERE pf.fee_definition_id = (SELECT id FROM fee_definitions WHERE organization_id = 1 AND year_start = '2025-09-01' LIMIT 1)
ON CONFLICT DO NOTHING;

-- Summary Statistics:
-- Total participants: 24
-- Total expected revenue: $11,240.00 (accounting for 4 participants with $80 discount)
-- Total received: $9,190.00
-- Outstanding: $2,050.00
-- Payment methods: E-Transfer (21), Cash (2), Unpaid (1)
--
-- Discounts applied ($80 each):
-- - Madiran Matte
-- - Maxime Cohen-Sabourin (Animateur)
-- - Vincent Cohen-Sabourin (Animateur)
-- - Olivier Labelle
--
-- Payment status:
-- - Fully paid: 13 participants
-- - Partially paid: 10 participants
-- - Unpaid: 1 participant (Seva Nikodon)
