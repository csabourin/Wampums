-- A budget item's default type was 'other', which budget_items_item_type_check
-- refuses ('revenue', 'expense' or 'both'). The route copied that default, so
-- every item created from the budget screen, which never sends a type, failed.
-- An item named without a type holds both.
ALTER TABLE public.budget_items ALTER COLUMN item_type SET DEFAULT 'both';
