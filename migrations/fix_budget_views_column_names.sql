-- =====================================================
-- Fix Budget Revenue View - Correct Column Names
-- Fixes: fundraisers.organization (not organization_id)
--        calendars.fundraiser (not fundraiser_id)
--        calendars doesn't have organization_id
-- =====================================================

-- Drop and recreate the view with correct column names
DROP VIEW IF EXISTS public.v_budget_summary_by_category;
DROP VIEW IF EXISTS public.v_budget_revenue;

-- 1. Recreate view for comprehensive revenue (with correct column names)
CREATE OR REPLACE VIEW public.v_budget_revenue AS
SELECT
  po.organization_id,
  bc.id AS budget_category_id,
  bc.name AS category_name,
  'participant_fee' AS revenue_source,
  py.payment_date AS revenue_date,
  py.amount,
  p.first_name || ' ' || p.last_name AS participant_name,
  py.id AS source_id
FROM payments py
JOIN participant_fees pf ON py.participant_fee_id = pf.id
JOIN participants p ON pf.participant_id = p.id
JOIN participant_organizations po ON p.id = po.participant_id
LEFT JOIN fee_definitions fd ON pf.fee_definition_id = fd.id
LEFT JOIN budget_categories bc ON fd.budget_category_id = bc.id

UNION ALL

-- FIXED: f.organization instead of f.organization_id
SELECT
  f.organization AS organization_id,
  f.budget_category_id,
  bc.name AS category_name,
  'fundraiser' AS revenue_source,
  COALESCE(f.end_date, f.start_date) AS revenue_date,
  f.result AS amount,
  f.name AS participant_name,
  f.id AS source_id
FROM fundraisers f
LEFT JOIN budget_categories bc ON f.budget_category_id = bc.id
WHERE f.result IS NOT NULL AND f.result > 0

UNION ALL

-- FIXED: Get organization_id through participant_organizations
--        Use c.fundraiser instead of c.fundraiser_id
SELECT
  po.organization_id,
  f.budget_category_id,
  bc.name AS category_name,
  'calendar_sale' AS revenue_source,
  c.updated_at::date AS revenue_date,
  c.amount_paid AS amount,
  p.first_name || ' ' || p.last_name AS participant_name,
  c.id AS source_id
FROM calendars c
JOIN participants p ON c.participant_id = p.id
JOIN participant_organizations po ON p.id = po.participant_id
LEFT JOIN fundraisers f ON c.fundraiser = f.id
LEFT JOIN budget_categories bc ON f.budget_category_id = bc.id
WHERE c.amount_paid > 0;

-- 2. Recreate view for budget summary by category
CREATE OR REPLACE VIEW public.v_budget_summary_by_category AS
WITH revenue AS (
  SELECT
    organization_id,
    budget_category_id,
    category_name,
    SUM(amount) AS total_revenue
  FROM v_budget_revenue
  GROUP BY organization_id, budget_category_id, category_name
),
expenses AS (
  SELECT
    organization_id,
    budget_category_id,
    bc.name AS category_name,
    SUM(amount) AS total_expense
  FROM budget_expenses be
  LEFT JOIN budget_categories bc ON be.budget_category_id = bc.id
  GROUP BY organization_id, budget_category_id, bc.name
)
SELECT
  COALESCE(r.organization_id, e.organization_id) AS organization_id,
  COALESCE(r.budget_category_id, e.budget_category_id) AS budget_category_id,
  COALESCE(r.category_name, e.category_name) AS category_name,
  COALESCE(r.total_revenue, 0) AS total_revenue,
  COALESCE(e.total_expense, 0) AS total_expense,
  COALESCE(r.total_revenue, 0) - COALESCE(e.total_expense, 0) AS net_amount
FROM revenue r
FULL OUTER JOIN expenses e
  ON r.organization_id = e.organization_id
  AND COALESCE(r.budget_category_id, 0) = COALESCE(e.budget_category_id, 0);

-- =====================================================
-- Migration complete!
-- Views now use correct column names:
-- ✓ fundraisers.organization (not organization_id)
-- ✓ calendars.fundraiser (not fundraiser_id)
-- ✓ calendars gets organization_id via participant_organizations join
-- =====================================================
