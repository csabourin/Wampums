-- Separate budget revenues from expenses
-- Creates dedicated budget_revenues table and migrates existing external revenue entries

BEGIN;

-- 1. Create budget_revenues table
CREATE TABLE IF NOT EXISTS public.budget_revenues (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_category_id INTEGER REFERENCES budget_categories(id),
  budget_item_id INTEGER REFERENCES budget_items(id),
  revenue_type VARCHAR(50) DEFAULT 'other',
  amount NUMERIC(10,2) NOT NULL,
  revenue_date DATE NOT NULL,
  description TEXT NOT NULL,
  payment_method VARCHAR(50),
  reference_number VARCHAR(100),
  receipt_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT positive_revenue_amount CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_budget_revenues_org_date
ON public.budget_revenues(organization_id, revenue_date);

CREATE INDEX IF NOT EXISTS idx_budget_revenues_category
ON public.budget_revenues(budget_category_id);

CREATE INDEX IF NOT EXISTS idx_budget_revenues_item
ON public.budget_revenues(budget_item_id);

-- 2. Migrate existing external revenue entries out of budget_expenses
INSERT INTO public.budget_revenues (
  organization_id,
  budget_category_id,
  budget_item_id,
  revenue_type,
  amount,
  revenue_date,
  description,
  payment_method,
  reference_number,
  receipt_url,
  notes,
  created_by,
  created_at,
  updated_at
)
SELECT
  be.organization_id,
  be.budget_category_id,
  be.budget_item_id,
  COALESCE((regexp_match(be.notes, '\\[TYPE:([^\\]]+)\\]'))[1], 'other') AS revenue_type,
  ABS(be.amount) AS amount,
  be.expense_date AS revenue_date,
  be.description,
  be.payment_method,
  be.reference_number,
  be.receipt_url,
  trim(regexp_replace(be.notes, '\\[EXTERNAL_REVENUE\\]|\\[TYPE:[^\\]]+\\]', '', 'g')) AS notes,
  be.created_by,
  be.created_at,
  be.updated_at
FROM public.budget_expenses be
WHERE be.notes LIKE '%[EXTERNAL_REVENUE]%'
ON CONFLICT DO NOTHING;

DELETE FROM public.budget_expenses WHERE notes LIKE '%[EXTERNAL_REVENUE]%';

-- 3. Refresh revenue view to include external revenues
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

SELECT
  f.organization,
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

SELECT
  f.organization,
  f.budget_category_id,
  bc.name AS category_name,
  'calendar_sale' AS revenue_source,
  c.updated_at::date AS revenue_date,
  c.amount_paid AS amount,
  p.first_name || ' ' || p.last_name AS participant_name,
  c.id AS source_id
FROM calendars c
JOIN participants p ON c.participant_id = p.id
LEFT JOIN fundraisers f ON c.fundraiser = f.id
LEFT JOIN budget_categories bc ON f.budget_category_id = bc.id
WHERE c.amount_paid > 0

UNION ALL

SELECT
  br.organization_id,
  br.budget_category_id,
  bc.name AS category_name,
  'external' AS revenue_source,
  br.revenue_date,
  br.amount,
  br.description AS participant_name,
  br.id AS source_id
FROM budget_revenues br
LEFT JOIN budget_categories bc ON br.budget_category_id = bc.id;

-- 4. Add trigger to maintain updated_at on budget_revenues
CREATE TRIGGER update_budget_revenues_updated_at
  BEFORE UPDATE ON budget_revenues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
