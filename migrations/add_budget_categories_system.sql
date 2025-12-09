-- =====================================================
-- Budget Categories System - Phase 1
-- Extends existing payment tracking with categorization
-- =====================================================

-- 1. Create budget categories table
CREATE TABLE IF NOT EXISTS public.budget_categories (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category_type VARCHAR(20) DEFAULT 'other' CHECK (category_type IN ('registration', 'fundraising', 'activity', 'operations', 'other')),
  display_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_budget_categories_org
ON public.budget_categories(organization_id);

-- 2. Extend fee_definitions to link to budget categories
-- This allows categorizing registration/membership fee revenue
ALTER TABLE public.fee_definitions
ADD COLUMN IF NOT EXISTS budget_category_id INTEGER REFERENCES budget_categories(id);

CREATE INDEX IF NOT EXISTS idx_fee_definitions_budget_category
ON public.fee_definitions(budget_category_id);

-- 3. Extend fundraisers to link to budget categories
-- This allows categorizing fundraising revenue
ALTER TABLE public.fundraisers
ADD COLUMN IF NOT EXISTS budget_category_id INTEGER REFERENCES budget_categories(id);

CREATE INDEX IF NOT EXISTS idx_fundraisers_budget_category
ON public.fundraisers(budget_category_id);

-- 4. Create budget items (line items within categories)
-- Examples: "Inscriptions (Cotisation 232,50) x24 jeunes", "Camp d'été", etc.
CREATE TABLE IF NOT EXISTS public.budget_items (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  item_type VARCHAR(20) DEFAULT 'other' CHECK (item_type IN ('revenue', 'expense', 'both')),
  unit_price NUMERIC(10,2),
  estimated_quantity INTEGER,
  display_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_items_category
ON public.budget_items(budget_category_id);

CREATE INDEX IF NOT EXISTS idx_budget_items_org
ON public.budget_items(organization_id);

-- 5. Create budget expenses table (NEW - for organizational expenses)
-- This is separate from participant fee payments
-- Examples: buying supplies, activity costs, camp expenses, equipment, etc.
CREATE TABLE IF NOT EXISTS public.budget_expenses (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_category_id INTEGER REFERENCES budget_categories(id),
  budget_item_id INTEGER REFERENCES budget_items(id),
  amount NUMERIC(10,2) NOT NULL,
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  payment_method VARCHAR(50),
  reference_number VARCHAR(100),
  receipt_url TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT positive_amount CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_budget_expenses_org_date
ON public.budget_expenses(organization_id, expense_date);

CREATE INDEX IF NOT EXISTS idx_budget_expenses_category
ON public.budget_expenses(budget_category_id);

CREATE INDEX IF NOT EXISTS idx_budget_expenses_item
ON public.budget_expenses(budget_item_id);

-- 6. Create budget plans table (for forecasting/planning)
CREATE TABLE IF NOT EXISTS public.budget_plans (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_item_id INTEGER REFERENCES budget_items(id),
  fiscal_year_start DATE NOT NULL,
  fiscal_year_end DATE NOT NULL,
  budgeted_revenue NUMERIC(10,2) DEFAULT 0,
  budgeted_expense NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, budget_item_id, fiscal_year_start)
);

CREATE INDEX IF NOT EXISTS idx_budget_plans_org_year
ON public.budget_plans(organization_id, fiscal_year_start);

-- 7. Create view for comprehensive revenue (combines all sources)
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
  f.organization_id,
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
  c.organization_id,
  f.budget_category_id,
  bc.name AS category_name,
  'calendar_sale' AS revenue_source,
  c.updated_at::date AS revenue_date,
  c.amount_paid AS amount,
  p.first_name || ' ' || p.last_name AS participant_name,
  c.id AS source_id
FROM calendars c
JOIN participants p ON c.participant_id = p.id
LEFT JOIN fundraisers f ON c.fundraiser_id = f.id
LEFT JOIN budget_categories bc ON f.budget_category_id = bc.id
WHERE c.amount_paid > 0;

-- 8. Create view for budget summary by category
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

-- 9. Insert default budget categories (based on the screenshot)
-- Note: This will only insert if the organization_id = 1 exists
-- Adjust organization_id as needed for your setup
INSERT INTO public.budget_categories (organization_id, name, description, category_type, display_order)
SELECT 1, 'Administration', 'Frais d''administration et inscriptions', 'registration', 1
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM budget_categories WHERE organization_id = 1 AND name = 'Administration')
UNION ALL
SELECT 1, 'Financement', 'Activités de financement et cotisations', 'fundraising', 2
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM budget_categories WHERE organization_id = 1 AND name = 'Financement')
UNION ALL
SELECT 1, 'Activité', 'Activités et événements spéciaux', 'activity', 3
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM budget_categories WHERE organization_id = 1 AND name = 'Activité')
UNION ALL
SELECT 1, 'Camp', 'Camps et sorties', 'activity', 4
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM budget_categories WHERE organization_id = 1 AND name = 'Camp')
UNION ALL
SELECT 1, 'Accessoires', 'Équipement et accessoires', 'operations', 5
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = 1)
  AND NOT EXISTS (SELECT 1 FROM budget_categories WHERE organization_id = 1 AND name = 'Accessoires');

-- 10. Add triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_budget_categories_updated_at
  BEFORE UPDATE ON budget_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_budget_items_updated_at
  BEFORE UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_budget_expenses_updated_at
  BEFORE UPDATE ON budget_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_budget_plans_updated_at
  BEFORE UPDATE ON budget_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Migration complete!
--
-- Summary:
-- ✓ Budget categories created
-- ✓ Existing fee_definitions linked to categories
-- ✓ Existing fundraisers linked to categories
-- ✓ Budget items (line items) created
-- ✓ Budget expenses table for org costs (NEW)
-- ✓ Budget plans for forecasting
-- ✓ Views combining all revenue sources + expenses
-- ✓ Default categories inserted
-- =====================================================
