-- Parents no longer reach the unit's finance workspace.
--
-- The parent role held finance.view. That permission opens the /finance
-- screen and the unit-wide finance API: every family's fees, payments and
-- payment plans, and the unit's financial summary. A parent could read all of
-- it and hit an error on every save. What a parent needs about money -- their
-- own children's statement and paying their own fees -- is served without
-- these permissions (/v1/finance/participants/:participantId/statement checks the
-- guardian link, Stripe checks the same).
--
-- The permissions below mean "the unit's money". A role that only sees its
-- own children (data_scope 'linked') cannot hold them coherently: the finance
-- routes do not filter by child. So they are taken from the parent roles by
-- name, and from any other role limited to linked data. Someone who is a
-- parent *and* treasurer keeps their access through the treasurer role.
--
--   finance.view, finance.manage, finance.approve   /finance, expenses, external revenue
--   budget.view, budget.manage                      budgets, revenue dashboard
--
-- Only role_permissions rows are deleted; the permissions themselves stay.

DELETE FROM role_permissions rp
 USING roles r, permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND (r.role_name IN ('parent', 'demoparent') OR r.data_scope = 'linked')
   AND p.permission_key IN (
     'finance.view',
     'finance.manage',
     'finance.approve',
     'budget.view',
     'budget.manage'
   );
