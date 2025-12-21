-- Migration: Create local groups and organization membership mapping
-- Description: Adds local_groups and organization_local_groups tables with baseline data

-- Create local_groups table to catalog regional groupings
CREATE TABLE IF NOT EXISTS local_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create join table linking organizations to local groups
CREATE TABLE IF NOT EXISTS organization_local_groups (
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    local_group_id INTEGER NOT NULL REFERENCES local_groups(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, local_group_id)
);

-- Baseline local groups to avoid hardcoding in application logic
INSERT INTO local_groups (name, slug)
VALUES
    ('Groupe 6 Aylmer', 'groupe-6-aylmer'),
    ('Hull', 'hull'),
    ('Gatineau', 'gatineau'),
    ('Ottawa', 'ottawa')
ON CONFLICT (slug) DO NOTHING;

-- Enroll initial organizations into Groupe 6 Aylmer for onboarding continuity
WITH target_group AS (
    SELECT id FROM local_groups WHERE slug = 'groupe-6-aylmer' LIMIT 1
)
INSERT INTO organization_local_groups (organization_id, local_group_id)
SELECT orgs.organization_id, target_group.id
FROM target_group
CROSS JOIN (VALUES (1), (2)) AS orgs(organization_id)
ON CONFLICT DO NOTHING;
