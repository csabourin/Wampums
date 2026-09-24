-- Parent invitations, family links, and the provenance of participant access
--
-- Three things arrive together here because they are one story: an admin wants
-- to hand a family the keys to their own registration, and the family wants to
-- decide for itself who else holds those keys.
--
-- 1. `parent_invitations` is a pending person. Registration today creates a
--    `users` row and a membership on the spot, which is the wrong shape for an
--    address that was typed by an admin and has not yet been claimed by anyone.
--    Nothing real exists until the recipient clicks and completes the form.
-- 2. `family_link_requests` / `family_links` are consent. One parent naming
--    another parent's address must not, by itself, open that parent's children
--    to a stranger. The request is the asking; the link is the answer.
-- 3. `participant_access_grants` is the memory of *why* someone can see a child.
--    `user_participants` records only that they can, which is enough until the
--    day a family link is revoked and we have to tell that link's access apart
--    from access the person already had for their own reasons.
--
-- Every statement is a no-op against a database that already has it. Foreign
-- keys are declared inside CREATE TABLE rather than added afterwards, because
-- ADD CONSTRAINT has no IF NOT EXISTS and a migration that fails on its second
-- run is one nobody dares re-run.

-- ---------------------------------------------------------------------------
-- Pending invitations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.parent_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id integer NOT NULL,
    -- Lower-cased and trimmed on the way in. The address is the identity of the
    -- invitation and the one field the recipient may not edit, so it is stored
    -- in the form it will be compared in.
    email text NOT NULL,
    first_name character varying(255),
    last_name character varying(255),
    telephone_residence character varying(20),
    telephone_cellulaire character varying(20),
    -- Shown on the completion page so a parent who hits trouble has someone to
    -- write to who is not a support address for the whole product.
    support_contact_name character varying(255),
    support_contact_email character varying(255),
    -- The language the invitation was written in. There is no user row to read
    -- a preference from yet, so the sending admin's language is recorded here
    -- and the completion page opens in it.
    language character varying(10),
    -- SHA-256 of the opaque token that went out in the link. The link is a
    -- bearer credential; what we keep is enough to recognise it and not enough
    -- to mint it, so a database leak does not hand anyone a live invitation.
    token_digest character(64) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    invited_by uuid,
    accepted_user_id uuid,
    -- Set only once the email provider has accepted the message. An invitation
    -- whose email failed is still pending and still re-sendable; it is simply
    -- one that nobody has received.
    sent_at timestamp with time zone,
    resend_count integer DEFAULT 0 NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    -- Set when the invited address belonged to a membership an administrator
    -- had deactivated by hand, and the inviting admin was shown that and chose
    -- to proceed anyway. Acceptance restores such a membership only when this is
    -- set; without it a hand deactivation queues for approval instead. The
    -- reason is the admin's own words, kept because "why was this family let
    -- back in?" is a question someone will eventually ask.
    deactivation_override_reason text,
    deactivation_override_at timestamp with time zone,
    -- Acceptance makes an account; completing the child wizard finishes the
    -- job. The gap between the two is what lets a parent who closed the tab be
    -- put back where they were after they log in.
    onboarding_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT parent_invitations_pkey PRIMARY KEY (id),
    CONSTRAINT parent_invitations_status_check
        CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text]))),
    CONSTRAINT parent_invitations_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT parent_invitations_invited_by_fkey
        FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT parent_invitations_accepted_user_id_fkey
        FOREIGN KEY (accepted_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT parent_invitations_revoked_by_fkey
        FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Expiry is read from `expires_at` against the clock, never written into
-- `status`. Nothing sweeps this table, so a link that lapsed on a Sunday is
-- expired on that Sunday rather than whenever a job next happens to run.
COMMENT ON COLUMN public.parent_invitations.status IS
  'Lifecycle the database controls: pending, accepted or revoked. Expiry is derived from expires_at and is deliberately not a status.';

-- One live invitation per address per unit. Accepted and revoked rows stay for
-- the audit trail and are excluded, so the same parent can be invited again
-- after a revocation without erasing the first attempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_invitations_live_email
  ON public.parent_invitations (organization_id, email)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_invitations_token_digest
  ON public.parent_invitations (token_digest);

-- The admin's pending list is the only frequent reader.
CREATE INDEX IF NOT EXISTS idx_parent_invitations_organization_status
  ON public.parent_invitations (organization_id, status, created_at DESC);

-- Resuming onboarding after login looks the invitation up by the account that
-- claimed it.
CREATE INDEX IF NOT EXISTS idx_parent_invitations_accepted_user
  ON public.parent_invitations (accepted_user_id)
  WHERE accepted_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Family link requests and the links they produce
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.family_link_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id integer NOT NULL,
    requester_user_id uuid NOT NULL,
    -- Normalized, like the invitation address. The person behind it may not
    -- have an account yet, which is why this is an address and not a user id.
    target_email text NOT NULL,
    token_digest character(64) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    resend_count integer DEFAULT 0 NOT NULL,
    responded_at timestamp with time zone,
    -- Who actually answered. Not necessarily an account that existed when the
    -- request was made.
    responded_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT family_link_requests_pkey PRIMARY KEY (id),
    CONSTRAINT family_link_requests_status_check
        CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'revoked'::text]))),
    CONSTRAINT family_link_requests_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT family_link_requests_requester_user_id_fkey
        FOREIGN KEY (requester_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT family_link_requests_responded_user_id_fkey
        FOREIGN KEY (responded_user_id) REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.family_link_requests IS
  'One parent asking another to share a family. Opening the emailed link changes nothing; only an explicit confirmation does.';

-- One outstanding ask at a time, so a parent cannot paper an inbox by pressing
-- the button repeatedly. Resending rotates the token on the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_link_requests_live
  ON public.family_link_requests (organization_id, requester_user_id, target_email)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_family_link_requests_token_digest
  ON public.family_link_requests (token_digest);

CREATE INDEX IF NOT EXISTS idx_family_link_requests_requester
  ON public.family_link_requests (requester_user_id, status);

CREATE SEQUENCE IF NOT EXISTS public.family_links_id_seq
  AS integer
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.family_links (
    id integer DEFAULT nextval('public.family_links_id_seq'::regclass) NOT NULL,
    organization_id integer NOT NULL,
    -- The pair is stored in a fixed order so that "are these two linked?" is one
    -- index lookup rather than two, and so the uniqueness constraint below
    -- cannot be sidestepped by asking in the other direction.
    user_id_low uuid NOT NULL,
    user_id_high uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_from_request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    CONSTRAINT family_links_pkey PRIMARY KEY (id),
    CONSTRAINT family_links_status_check
        CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text]))),
    CONSTRAINT family_links_ordered_pair CHECK ((user_id_low < user_id_high)),
    CONSTRAINT family_links_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT family_links_user_id_low_fkey
        FOREIGN KEY (user_id_low) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT family_links_user_id_high_fkey
        FOREIGN KEY (user_id_high) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT family_links_created_from_request_id_fkey
        FOREIGN KEY (created_from_request_id) REFERENCES public.family_link_requests(id) ON DELETE SET NULL,
    CONSTRAINT family_links_revoked_by_fkey
        FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER SEQUENCE public.family_links_id_seq OWNED BY public.family_links.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_family_links_active_pair
  ON public.family_links (organization_id, user_id_low, user_id_high)
  WHERE status = 'active';

-- "Who is in this person's family?" has to be answerable from either side.
CREATE INDEX IF NOT EXISTS idx_family_links_user_low
  ON public.family_links (user_id_low, organization_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_family_links_user_high
  ON public.family_links (user_id_high, organization_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Why someone can see a child
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.participant_access_grants_id_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.participant_access_grants (
    id bigint DEFAULT nextval('public.participant_access_grants_id_seq'::regclass) NOT NULL,
    participant_id integer NOT NULL,
    user_id uuid NOT NULL,
    -- Why this person may see this child:
    --   direct       a parent's access to their own child, or a pre-existing
    --                association from before this table
    --   guardian     follows from a parents_guardians record
    --   admin        an administrator linked them by hand
    --   family_link  they are linked to someone who has access
    source_type text NOT NULL,
    -- The thing named by source_type, as text because it is a family_links id,
    -- a parents_guardians id or a user uuid depending on the source.
    source_id text,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT participant_access_grants_pkey PRIMARY KEY (id),
    CONSTRAINT participant_access_grants_source_type_check
        CHECK ((source_type = ANY (ARRAY['direct'::text, 'guardian'::text, 'admin'::text, 'family_link'::text]))),
    CONSTRAINT participant_access_grants_participant_id_fkey
        FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE,
    CONSTRAINT participant_access_grants_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT participant_access_grants_granted_by_fkey
        FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER SEQUENCE public.participant_access_grants_id_seq OWNED BY public.participant_access_grants.id;

COMMENT ON TABLE public.participant_access_grants IS
  'Provenance for user_participants. A person may hold access for several reasons at once; removing one reason must not remove the others, which is the question user_participants alone cannot answer.';

-- One live grant per reason. The same pair may appear several times with
-- different source types, which is the entire point.
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_access_grants_live
  ON public.participant_access_grants (participant_id, user_id, source_type, COALESCE(source_id, ''))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_participant_access_grants_user
  ON public.participant_access_grants (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_participant_access_grants_source
  ON public.participant_access_grants (source_type, source_id)
  WHERE revoked_at IS NULL;

-- Backfill.
--
-- Existing associations carry no record of where they came from, and guessing
-- would be worse than admitting it: a row a guardian import created and a row
-- an admin clicked into being look identical today. They all land as `direct`,
-- which is the one source no automated process revokes. A family link can only
-- ever remove what that link itself granted, so nothing here is at risk of
-- being swept away later.
INSERT INTO public.participant_access_grants (participant_id, user_id, source_type, source_id)
SELECT up.participant_id, up.user_id, 'direct', NULL
  FROM public.user_participants up
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.participant_access_grants g
    WHERE g.participant_id = up.participant_id
      AND g.user_id = up.user_id
      AND g.source_type = 'direct'
      AND g.source_id IS NULL
      AND g.revoked_at IS NULL
 );

-- ---------------------------------------------------------------------------
-- The permission a parent needs to register their own child
-- ---------------------------------------------------------------------------

-- Deliberately not `participants.create`. That permission is unscoped: it lets
-- a holder add a participant to the unit. A parent needs to add a participant
-- to their own family, and the route that carries this key is the one that
-- guarantees the link. Handing parents the broad key instead would make every
-- parent an author of unit-wide records.
-- The permission catalog was seeded with explicit ids, which does not advance
-- the sequence behind the column. Any database loaded that way has a sequence
-- sitting at 1 while the table runs to 86, so an insert that trusts the default
-- claims id 1 and dies on the primary key. `deploy-migrate` runs every
-- migration in a single transaction and exits non-zero on failure, so that one
-- collision would not fail this statement -- it would block the deploy and stop
-- the server from booting at all.
SELECT setval(
  pg_get_serial_sequence('public.permissions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.permissions), 0) + 1,
  false
);

INSERT INTO public.permissions (permission_key, permission_name, category, description)
VALUES (
  'participants.create_own',
  'Register Own Children',
  'participants',
  'Create a participant linked to the creator''s own family'
)
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE r.role_name = 'parent'
   AND p.permission_key = 'participants.create_own'
ON CONFLICT (role_id, permission_id) DO NOTHING;
