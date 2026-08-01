-- Migration: make the organization ↔ program section FK deferrable
--
-- `organizations.program_section` references `organization_program_sections`,
-- which in turn references `organizations`. Both constraints are checked
-- immediately, so the pair is unsatisfiable for a brand new organization:
--
--   INSERT INTO organizations (name) VALUES ('...');
--   ERROR:  insert or update on table "organizations" violates foreign key
--           constraint "organizations_program_section_fk"
--   DETAIL:  Key (id, program_section)=(7, general) is not present in table
--            "organization_program_sections".
--
-- The section row cannot exist before the organization it belongs to, and the
-- organization cannot exist before its section row. Every code path that
-- creates an organization has been dead since the constraint was added —
-- `POST /api/v1/organizations` included, despite it calling
-- `ensureProgramSectionsSeeded` in the same transaction.
--
-- Deferring to COMMIT is the right resolution rather than dropping the
-- constraint: the invariant we actually care about is "no organization points
-- at a section that does not exist", and that is a statement about committed
-- state, not about the order of two inserts inside one transaction. Callers
-- keep full protection; they simply get to seed the sections after the
-- organization row exists.
--
-- INITIALLY DEFERRED rather than DEFERRABLE alone: it makes the fix work
-- without every existing caller having to remember `SET CONSTRAINTS`.
--
-- Deferring only this direction is enough. Once the organization row exists
-- inside the transaction, a section row pointing back at it is valid
-- immediately, so `organization_program_sections_organization_id_fkey` can stay
-- as it is.
--
-- This also unbreaks deletion: `ON DELETE CASCADE` removes the section rows when
-- an organization goes, which used to trip the RESTRICT on the way out. Deferred
-- to COMMIT, both rows are gone by the time anything is checked.
--
-- ALTER CONSTRAINT rewrites the catalog entry and nothing else — no table scan,
-- no revalidation, no rewrite. It takes an ACCESS EXCLUSIVE lock, but holds it
-- for an instant. (Dropping and re-adding the constraint would reach the same
-- state, at the cost of a full revalidation of the table.)
--
-- Safe to run more than once: ALTER CONSTRAINT is idempotent.

BEGIN;

-- Guard against the situation the constraint exists to prevent ever having been
-- reached while it was unenforceable: any organization pointing at a section
-- that was never seeded gets its six defaults. This is a no-op on a healthy
-- database.
--
-- ALTER CONSTRAINT does not revalidate, so an orphaned row would otherwise sit
-- there undetected until the next write to `organizations` failed. Repairing
-- first means the constraint is true of the data the moment it is deferred.
INSERT INTO organization_program_sections (organization_id, section_key, display_name)
SELECT o.id, d.section_key, d.display_name
  FROM organizations o
 CROSS JOIN (
   VALUES ('general',  'Général'),
          ('beavers',  'Castors'),
          ('cubs',     'Louveteaux'),
          ('scouts',   'Éclaireurs'),
          ('pioneers', 'Pionniers'),
          ('rovers',   'Routiers')
 ) AS d(section_key, display_name)
 WHERE NOT EXISTS (
   SELECT 1
     FROM organization_program_sections s
    WHERE s.organization_id = o.id
      AND s.section_key = o.program_section
 )
ON CONFLICT (organization_id, section_key) DO NOTHING;

ALTER TABLE organizations
  ALTER CONSTRAINT organizations_program_section_fk DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT organizations_program_section_fk ON organizations IS
  'Deferred by necessity: organization_program_sections references organizations back, so an organization and its default section can only be created together, inside one transaction.';

COMMIT;
