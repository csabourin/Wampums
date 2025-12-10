BEGIN;

-- Create announcements table for drafting, scheduling, and delivering outbound messages
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    recipient_roles TEXT[] NOT NULL DEFAULT '{}',
    recipient_groups INTEGER[] DEFAULT '{}',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_org_status ON announcements (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled ON announcements (scheduled_at);

-- Log table for auditing per-recipient delivery attempts
CREATE TABLE IF NOT EXISTS announcement_logs (
    id SERIAL PRIMARY KEY,
    announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL,
    recipient_email TEXT,
    recipient_user_id UUID,
    status VARCHAR(32) NOT NULL,
    error_message TEXT,
    metadata JSONB,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure unique key on organization settings for idempotent upserts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organization_settings_organization_id_setting_key_key'
    ) THEN
        ALTER TABLE organization_settings
        ADD CONSTRAINT organization_settings_organization_id_setting_key_key UNIQUE (organization_id, setting_key);
    END IF;
END $$;

-- Preload French announcement templates for organization 0 (defaults) and organization 1
INSERT INTO organization_settings (organization_id, setting_key, setting_value, updated_at)
VALUES
    (
        0,
        'announcement_templates',
        '[
          {"key": "rappel_sortie", "title": "Rappel pour une sortie", "subject": "Rappel de sortie : pensez aux autorisations", "body": "Bonjour,\n\nCeci est un rappel pour la sortie à venir. Merci d\"apporter les autorisations signées et tout le matériel nécessaire.\n\nA très bientôt,\nL\"équipe d\"animation"},
          {"key": "celebration", "title": "Félicitations et célébrations", "subject": "Bravo à notre groupe !", "body": "Bonjour,\n\nNous tenions à féliciter les jeunes pour leurs efforts récents. Merci à toutes les familles pour leur soutien continu.\n\nAu plaisir de vous revoir,\nL\"équipe"},
          {"key": "information_generale", "title": "Information générale", "subject": "Informations importantes de la semaine", "body": "Bonjour,\n\nVoici les informations importantes pour la semaine : horaires, rappels et points clés. N\"hésitez pas à nous écrire si vous avez des questions.\n\nMerci,\nL\"équipe"}
        ]'::jsonb,
        NOW()
    ),
    (
        1,
        'announcement_templates',
        '[
          {"key": "rappel_sortie", "title": "Rappel pour la sortie de samedi", "subject": "Sortie de samedi : détails pratiques", "body": "Bonjour,\n\nNous partons en sortie samedi. Pensez à la gourde, au repas froid et aux vêtements adaptés. Merci d\"arriver 10 minutes à l\"avance.\n\nMerci,\nL\"équipe"},
          {"key": "appel_benevoles", "title": "Appel aux bénévoles", "subject": "Besoin de bénévoles pour notre activité", "body": "Bonjour,\n\nNous recherchons quelques bénévoles pour encadrer l\"activité de la semaine prochaine. Merci de nous indiquer vos disponibilités.\n\nMerci d\"avance !"},
          {"key": "remerciements", "title": "Remerciements", "subject": "Merci pour votre participation", "body": "Bonjour,\n\nMerci à toutes les familles et aux jeunes pour leur présence et leur énergie. Votre soutien fait toute la différence.\n\nA bientôt,\nL\"équipe"}
        ]'::jsonb,
        NOW()
    )
ON CONFLICT (organization_id, setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    updated_at = NOW();

COMMIT;
