-- A unit approves the leaders who join it, for itself alone.
--
-- A leader who registered waited for approval as an account (users.is_verified),
-- and approving them in any unit they belonged to opened every unit: an
-- administrator of unit B could approve someone waiting in unit A. Approval is
-- now a membership's state: 'pending' until that unit approves it.

ALTER TABLE public.user_organizations DROP CONSTRAINT IF EXISTS user_organizations_status_check;
ALTER TABLE public.user_organizations ADD CONSTRAINT user_organizations_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'alumni'::text, 'pending'::text]));

COMMENT ON COLUMN public.user_organizations.status IS
  'active, inactive (closed), alumni, or pending: a leader who registered, until this unit approves them.';

-- Leaders still waiting: accounts that registered themselves (they have a
-- password) and were never approved. Each of their memberships with a role
-- beyond the family's waits for its own unit; the account itself is verified.
UPDATE public.user_organizations uo
   SET status = 'pending'
  FROM public.users u
 WHERE u.id = uo.user_id
   AND u.is_verified = false
   AND COALESCE(u.password, '') <> ''
   AND uo.status = 'active'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
       JOIN public.roles r ON r.id = role_id_text::integer
      WHERE r.data_scope IS DISTINCT FROM 'linked'
   );

UPDATE public.users u
   SET is_verified = true
 WHERE u.is_verified = false
   AND COALESCE(u.password, '') <> ''
   AND EXISTS (SELECT 1 FROM public.user_organizations uo WHERE uo.user_id = u.id AND uo.status = 'pending');
