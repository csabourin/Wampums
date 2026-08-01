-- Migration: stop counting a participant fee once per enrollment year
--
-- REGRESSION introduced by create_scout_years_and_enrollments.sql.
--
-- `v_budget_revenue` was written when `participant_organizations` was a table
-- holding exactly one row per participant per organization, so joining it on
-- `participant_id` alone was harmless. Renaming that table to
-- `participant_enrollments` re-pointed the view automatically — a view stores
-- the table's OID, not its name, so nothing errored and nothing warned. The
-- join then matched one row *per scout year*.
--
-- Consequences, both live:
--   * a payment is emitted once for every year the participant has been
--     enrolled, so revenue totals inflate at every year transition — a family in
--     its third season counts its fees three times;
--   * the row takes each enrollment's organization_id rather than the fee's, so
--     a participant transferred to a sister unit can surface a fee under the
--     wrong tenant, in a budget that never collected it.
--
-- The fix is to drop the join outright: `participant_fees` carries its own
-- NOT NULL `organization_id`, which is the authoritative owner of the money.
-- The enrollment table was never needed here.
--
-- Safe to run more than once.

BEGIN;

CREATE OR REPLACE VIEW public.v_budget_revenue WITH (security_invoker = 'on') AS
 SELECT pf.organization_id,
    bc.id AS budget_category_id,
    bc.name AS category_name,
    'participant_fee'::text AS revenue_source,
    py.payment_date AS revenue_date,
    py.amount,
    (((p.first_name)::text || ' '::text) || (p.last_name)::text) AS participant_name,
    py.id AS source_id
   FROM (((public.payments py
     JOIN public.participant_fees pf ON ((py.participant_fee_id = pf.id)))
     JOIN public.participants p ON ((pf.participant_id = p.id)))
     LEFT JOIN public.fee_definitions fd ON ((pf.fee_definition_id = fd.id)))
     LEFT JOIN public.budget_categories bc ON ((fd.budget_category_id = bc.id))
UNION ALL
 SELECT f.organization AS organization_id,
    f.budget_category_id,
    bc.name AS category_name,
    'fundraiser'::text AS revenue_source,
    COALESCE(f.end_date, f.start_date) AS revenue_date,
    f.result AS amount,
    f.name AS participant_name,
    f.id AS source_id
   FROM (public.fundraisers f
     LEFT JOIN public.budget_categories bc ON ((f.budget_category_id = bc.id)))
  WHERE ((f.result IS NOT NULL) AND (f.result > (0)::numeric))
UNION ALL
 SELECT f.organization AS organization_id,
    f.budget_category_id,
    bc.name AS category_name,
    'calendar_sale'::text AS revenue_source,
    (c.updated_at)::date AS revenue_date,
    c.amount_paid AS amount,
    (((p.first_name)::text || ' '::text) || (p.last_name)::text) AS participant_name,
    c.id AS source_id
   FROM (((public.fundraiser_entries c
     JOIN public.participants p ON ((c.participant_id = p.id)))
     LEFT JOIN public.fundraisers f ON ((c.fundraiser = f.id)))
     LEFT JOIN public.budget_categories bc ON ((f.budget_category_id = bc.id)))
  WHERE (c.amount_paid > (0)::double precision)
UNION ALL
 SELECT br.organization_id,
    br.budget_category_id,
    bc.name AS category_name,
    'external'::text AS revenue_source,
    br.revenue_date,
    br.amount,
    br.description AS participant_name,
    br.id AS source_id
   FROM (public.budget_revenues br
     LEFT JOIN public.budget_categories bc ON ((br.budget_category_id = bc.id)));

COMMENT ON VIEW public.v_budget_revenue IS
  'Every revenue line of an organization. Participant fees are attributed through participant_fees.organization_id, never through an enrollment: a participant has one enrollment per scout year, and joining them would count each payment once per year.';

COMMIT;
