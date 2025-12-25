-- Seed 2025-2026 Budget Categories, Items, Revenues and Expenses for Organization 1
-- Migration created: 2025-12-25
-- This migration creates budget structure and populates revenue/expense transactions

-- Create budget categories if they don't exist
INSERT INTO budget_categories (organization_id, name, description, category_type, display_order, active, created_at)
VALUES
  (1, 'Administration', 'Frais administratifs et cotisations', 'registration', 1, true, CURRENT_TIMESTAMP),
  (1, 'Financement', 'Revenus de financement et levées de fonds', 'fundraising', 2, true, CURRENT_TIMESTAMP),
  (1, 'Activité', 'Dépenses pour activités régulières', 'activity', 3, true, CURRENT_TIMESTAMP),
  (1, 'Camp', 'Dépenses pour camps et sorties', 'activity', 4, true, CURRENT_TIMESTAMP),
  (1, 'Accessoires', 'Équipement et accessoires d''uniforme', 'operations', 5, true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Create budget items for each category
-- Administration items
INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Inscriptions (Cotisations)', 'Cotisations des jeunes (232,50$ x 24)', 'revenue', 232.50, 24, 1, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Administration'
ON CONFLICT DO NOTHING;

INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Paiement au district', 'Cotisations versées au district (232,50$ x 24)', 'expense', 232.50, 24, 2, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Administration'
ON CONFLICT DO NOTHING;

-- Financement items
INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Cotisations', 'Frais d''inscription des jeunes (277,50$ x 24)', 'revenue', 277.50, 24, 1, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Financement'
ON CONFLICT DO NOTHING;

INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Vente de calendrier', 'Vente de calendriers (50% de 10$ x 12 cal x 24 jeunes)', 'revenue', 5.00, 288, 2, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Financement'
ON CONFLICT DO NOTHING;

INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Stationnement FMG', 'Revenus de stationnement FMG', 'revenue', NULL, NULL, 3, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Financement'
ON CONFLICT DO NOTHING;

INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Activité à déterminer', 'Revenus d''activité de financement future', 'revenue', NULL, NULL, 4, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Financement'
ON CONFLICT DO NOTHING;

-- Activité items
INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Promesse', 'Cérémonie de promesse (1 nuitée)', 'expense', 250.00, 1, 1, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Activité'
ON CONFLICT DO NOTHING;

INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Activités thématiques', 'Halloween, St-Valentin, etc.', 'expense', 100.00, 1, 2, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Activité'
ON CONFLICT DO NOTHING;

-- Camp items
INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Camp Technique', 'Camp technique', 'expense', 300.00, 1, 1, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Camp'
ON CONFLICT DO NOTHING;

INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Camp hiver', 'Camp d''hiver (2 nuitées, hébergement et nourriture)', 'expense', 3000.00, 1, 2, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Camp'
ON CONFLICT DO NOTHING;

INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Camp d''été', 'Camp d''été (7 jours, hébergement, nourriture, cadeaux et t-shirt)', 'expense', 5200.00, 1, 3, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Camp'
ON CONFLICT DO NOTHING;

-- Accessoires items
INSERT INTO budget_items (organization_id, budget_category_id, name, description, item_type, unit_price, estimated_quantity, display_order, active)
SELECT 1, bc.id, 'Équipement', 'Foulards, écussons, accessoires d''uniforme, etc.', 'expense', 300.00, 1, 1, true
FROM budget_categories bc WHERE bc.organization_id = 1 AND bc.name = 'Accessoires'
ON CONFLICT DO NOTHING;

-- Insert revenue transactions for 2025-2026
-- Administration revenue
INSERT INTO budget_revenues (organization_id, budget_category_id, budget_item_id, revenue_type, amount, revenue_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  'registration',
  5580.00,
  '2025-09-01'::date,
  'Cotisations des jeunes (232,50$ x 24)',
  'various',
  'Revenus des cotisations pour l''année 2025-2026'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Administration'
  AND bi.name = 'Inscriptions (Cotisations)'
ON CONFLICT DO NOTHING;

-- Financement revenues
INSERT INTO budget_revenues (organization_id, budget_category_id, budget_item_id, revenue_type, amount, revenue_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  'fundraising',
  6660.00,
  '2025-09-01'::date,
  'Frais d''inscription (277,50$ x 24 jeunes)',
  'various',
  'Revenus des inscriptions pour l''année 2025-2026'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Financement'
  AND bi.name = 'Cotisations'
ON CONFLICT DO NOTHING;

INSERT INTO budget_revenues (organization_id, budget_category_id, budget_item_id, revenue_type, amount, revenue_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  'fundraising',
  1440.00,
  '2025-10-01'::date,
  'Vente de calendriers (50% de 10$ x 12 cal x 24 jeunes)',
  'various',
  'Revenus de la campagne de calendriers 2025'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Financement'
  AND bi.name = 'Vente de calendrier'
ON CONFLICT DO NOTHING;

INSERT INTO budget_revenues (organization_id, budget_category_id, budget_item_id, revenue_type, amount, revenue_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  'fundraising',
  678.75,
  '2025-10-01'::date,
  'Revenus de stationnement FMG',
  'e-transfer',
  'Revenus du stationnement FMG'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Financement'
  AND bi.name = 'Stationnement FMG'
ON CONFLICT DO NOTHING;

INSERT INTO budget_revenues (organization_id, budget_category_id, budget_item_id, revenue_type, amount, revenue_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  'fundraising',
  400.00,
  '2025-11-01'::date,
  'Revenus d''activité de financement à déterminer',
  'various',
  'Revenus futurs d''activité de financement'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Financement'
  AND bi.name = 'Activité à déterminer'
ON CONFLICT DO NOTHING;

-- Insert expense transactions for 2025-2026
-- Administration expense
INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  5580.00,
  '2025-09-15'::date,
  'Paiement des cotisations au district (232,50$ x 24 jeunes)',
  'e-transfer',
  'Versement annuel au district'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Administration'
  AND bi.name = 'Paiement au district'
ON CONFLICT DO NOTHING;

-- Activité expenses
INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  250.00,
  '2025-10-01'::date,
  'Cérémonie de promesse (1 nuitée)',
  'various',
  'Dépenses pour la cérémonie de promesse'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Activité'
  AND bi.name = 'Promesse'
ON CONFLICT DO NOTHING;

INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  100.00,
  '2025-10-31'::date,
  'Activités thématiques (Halloween, St-Valentin, etc.)',
  'cash',
  'Dépenses pour activités thématiques de l''année'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Activité'
  AND bi.name = 'Activités thématiques'
ON CONFLICT DO NOTHING;

-- Camp expenses
INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  300.00,
  '2025-11-01'::date,
  'Camp technique',
  'e-transfer',
  'Dépenses pour le camp technique'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Camp'
  AND bi.name = 'Camp Technique'
ON CONFLICT DO NOTHING;

INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  3000.00,
  '2026-02-01'::date,
  'Camp d''hiver (2 nuitées, hébergement et nourriture)',
  'e-transfer',
  'Dépenses pour le camp d''hiver'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Camp'
  AND bi.name = 'Camp hiver'
ON CONFLICT DO NOTHING;

INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  5200.00,
  '2026-07-01'::date,
  'Camp d''été (7 jours, hébergement, nourriture, cadeaux et t-shirt)',
  'e-transfer',
  'Dépenses pour le camp d''été'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Camp'
  AND bi.name = 'Camp d''été'
ON CONFLICT DO NOTHING;

-- Accessoires expenses
INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, notes)
SELECT
  1,
  bc.id,
  bi.id,
  300.00,
  '2025-09-15'::date,
  'Équipement (foulards, écussons, accessoires d''uniforme, etc.)',
  'credit_card',
  'Achat d''équipement et accessoires pour l''année'
FROM budget_categories bc
JOIN budget_items bi ON bi.budget_category_id = bc.id
WHERE bc.organization_id = 1
  AND bc.name = 'Accessoires'
  AND bi.name = 'Équipement'
ON CONFLICT DO NOTHING;

-- Create budget plan for 2025-2026 fiscal year
INSERT INTO budget_plans (organization_id, budget_item_id, fiscal_year_start, fiscal_year_end, budgeted_revenue, budgeted_expense, notes)
SELECT
  1,
  bi.id,
  '2025-09-01'::date,
  '2026-08-31'::date,
  CASE WHEN bi.item_type IN ('revenue', 'both') THEN bi.unit_price * COALESCE(bi.estimated_quantity, 1) ELSE 0 END,
  CASE WHEN bi.item_type IN ('expense', 'both') THEN bi.unit_price * COALESCE(bi.estimated_quantity, 1) ELSE 0 END,
  'Budget prévisionnel pour l''année 2025-2026'
FROM budget_items bi
JOIN budget_categories bc ON bc.id = bi.budget_category_id
WHERE bc.organization_id = 1
  AND bi.unit_price IS NOT NULL
ON CONFLICT DO NOTHING;

-- Summary Statistics:
-- Total Revenues: $14,758.75
--   - Administration (Cotisations): $5,580.00
--   - Financement (Inscriptions): $6,660.00
--   - Financement (Calendrier): $1,440.00
--   - Financement (Stationnement FMG): $678.75
--   - Financement (Activité future): $400.00
--
-- Total Expenses: $14,730.00
--   - Administration (District): $5,580.00
--   - Activité (Promesse): $250.00
--   - Activité (Thématiques): $100.00
--   - Camp (Technique): $300.00
--   - Camp (Hiver): $3,000.00
--   - Camp (Été): $5,200.00
--   - Accessoires (Équipement): $300.00
--
-- Net Surplus: $28.75
