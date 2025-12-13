-- Seed shared equipment inventory for organizations 1 and 2
-- French corrections applied to all item names

-- Add new categories to organization settings
UPDATE organization_settings
SET setting_value = '{"categories":["safety","games","camping","documentation","kitchen","cleaning","sports","tools","storage","winter","decoration","crafts"]}'::jsonb
WHERE setting_key = 'equipment_categories'
  AND organization_id IN (1, 2);

INSERT INTO organization_settings (organization_id, setting_key, setting_value)
SELECT org_id, 'equipment_categories',
       '{"categories":["safety","games","camping","documentation","kitchen","cleaning","sports","tools","storage","winter","decoration","crafts"]}'::jsonb
FROM (VALUES (1), (2)) AS orgs(org_id)
WHERE NOT EXISTS (
  SELECT 1 FROM organization_settings s
  WHERE s.organization_id = org_id AND s.setting_key = 'equipment_categories'
);

-- Insert equipment items owned by organization 1, shared with organization 2
INSERT INTO equipment_items (organization_id, name, category, description, quantity_total, quantity_available, condition_note, attributes)
SELECT 1, name, category, description, qty, qty, condition_note, '{}'::jsonb
FROM (
  VALUES
    -- Kitchen / Cuisine
    ('Bouteilles de savon à vaisselle', 'kitchen', 'Savon liquide pour vaisselle', 3, NULL),
    ('Bac bleu avec bac à vaisselle et bâton', 'kitchen', 'Ensemble pour lavage de vaisselle', 1, NULL),
    ('Grosse bouteille de savon', 'kitchen', 'Savon en format économique', 1, NULL),
    ('Pichets de lait', 'kitchen', 'Pichets pour service du lait', 4, NULL),
    ('Passoires', 'kitchen', 'Passoires de cuisine', 9, NULL),
    ('Plateaux de vaisselle', 'kitchen', 'Plateaux pour transport de vaisselle', 4, NULL),
    ('Réfrigérateur', 'kitchen', 'Réfrigérateur pour entreposage', 1, NULL),
    ('Cuisinières', 'kitchen', 'Cuisinières pour préparation des repas', 2, NULL),
    ('Contenants à boisson jaune et orange', 'kitchen', 'Grands contenants pour boissons', 2, NULL),
    ('Boîte avec boîtes à lunch et ustensiles', 'kitchen', 'Contient 3 boîtes à lunch, fourchettes, cuillères et couteaux', 1, NULL),

    -- Camping
    ('Hutte avec base carrée et drap bash', 'camping', 'Structure de hutte complète', 1, NULL),
    ('Coffres gris avec tuyaux de cheminée', 'camping', 'Coffres contenant équipement de cheminée', 3, NULL),
    ('Coffres gris (contenu incertain)', 'camping', 'Coffres gris à inventorier', 2, NULL),
    ('Tentes prospecteur (grandeur inconnue)', 'camping', 'Tentes de style prospecteur', 6, NULL),
    ('Seau avec piquets en métal larges', 'camping', 'Piquets pour installation de tentes', 1, NULL),
    ('Foyers en métal', 'camping', 'Foyers portatifs pour feux de camp', 4, NULL),
    ('Caisse de cordes épaisses', 'camping', 'Cordes robustes pour installations', 1, NULL),
    ('Coffre gris avec hache et sciotte', 'camping', 'Outils de coupe pour le bois', 1, NULL),
    ('Rouleau isolant métallique', 'camping', 'Isolant pour abris', 1, NULL),
    ('Bac bleu pâle avec cordes variées', 'camping', 'Assortiment de cordes diverses', 1, NULL),
    ('Brewer''s Marine - Corde', 'camping', 'Corde marine de qualité', 1, NULL),

    -- Sports
    ('Tirs à l''arc', 'sports', 'Équipement de tir à l''arc', 4, NULL),
    ('Flèches avec étui', 'sports', 'Flèches pour tir à l''arc avec rangement', 15, NULL),
    ('Coffre de raquettes', 'sports', 'Ensemble de raquettes diverses', 1, NULL),
    ('Caisse de ballons de soccer', 'sports', 'Ballons de soccer', 1, NULL),
    ('Seau avec 6 bâtons de baseball', 'sports', 'Bâtons de baseball', 1, NULL),
    ('Parachute', 'sports', 'Parachute pour jeux de groupe', 1, NULL),
    ('Coffre blanc avec raquettes', 'sports', 'Raquettes de sport', 1, NULL),

    -- Games / Jeux
    ('Cerceaux', 'games', 'Cerceaux pour activités', 12, NULL),
    ('Bac de jouets d''été', 'games', 'Jouets pour activités estivales', 1, NULL),
    ('Boîte méli-mélo', 'games', 'Articles de jeux divers', 1, NULL),
    ('Bac méli-mélo', 'games', 'Articles de jeux divers', 1, NULL),
    ('Caisse de briques', 'games', 'Briques de construction', 1, NULL),
    ('Loupes (sac de 8)', 'games', 'Loupes pour exploration', 1, NULL),

    -- Winter / Hiver
    ('Pelles pour déneiger', 'winter', 'Pelles à neige', 3, NULL),
    ('Seaux avec tapis crazy carpet', 'winter', 'Tapis pour glissade', 2, NULL),
    ('Soucoupes bleues pour glissade', 'winter', 'Soucoupes de glissade', 14, NULL),

    -- Tools / Outils
    ('Râteaux', 'tools', 'Râteaux standards', 3, NULL),
    ('Râteaux de jardin', 'tools', 'Râteaux pour jardinage', 8, NULL),
    ('Chariot à 2 roues avec toile verte', 'tools', 'Chariot de transport', 1, NULL),
    ('Pelles carrées et pointues', 'tools', 'Pelles polyvalentes', 8, NULL),
    ('Meuleuse d''établi Shopcraft 6 pouces', 'tools', 'Meuleuse usage intensif', 1, NULL),
    ('Aspirateur Shopvac Craftsman', 'tools', 'Aspirateur d''atelier', 1, NULL),
    ('Poubelles en métal', 'tools', 'Poubelles métalliques', 2, NULL),
    ('Objet métallique inconnu', 'tools', 'À identifier', 1, NULL),

    -- Cleaning / Nettoyage
    ('Balais de plancher', 'cleaning', 'Balais pour nettoyage', 2, NULL),
    ('Boîtes à savon', 'cleaning', 'Contenants pour savon', 3, NULL),
    ('Seau à vadrouille avec vadrouille', 'cleaning', 'Ensemble de nettoyage', 1, NULL),

    -- Safety / Sécurité
    ('Valise avec livres de secourisme d''urgence', 'safety', 'Documentation de premiers soins', 1, NULL),
    ('Extincteurs (expirés)', 'safety', 'À remplacer - expirés', 2, 'ATTENTION: Expirés - à remplacer'),
    ('Cadenas', 'safety', 'Cadenas de sécurité', 1, NULL),

    -- Decoration / Décoration
    ('Croix en bois pour promesse', 'decoration', 'Croix pour cérémonies de promesse', 2, NULL),
    ('Tableau vert avec support', 'decoration', 'Tableau d''affichage', 1, NULL),
    ('Affiche Sportiloup 2007', 'decoration', 'Affiche souvenir', 1, NULL),
    ('Planches de bois', 'decoration', 'Planches diverses', 10, NULL),
    ('Pancartes symboles scouts', 'decoration', 'Pancartes avec symboles', 4, NULL),
    ('Bases de drapeau', 'decoration', 'Supports pour drapeaux', 4, NULL),
    ('Décorations et costumes de canot', 'decoration', 'Accessoires thématiques', 2, NULL),
    ('Bateaux de camp', 'decoration', 'Bateaux décoratifs ou accessoires', 4, NULL),
    ('Décorations d''Halloween', 'decoration', 'Décorations saisonnières', 10, NULL),
    ('Foulards nationaux', 'decoration', 'Foulards pour cérémonies', 5, NULL),
    ('Boucliers en bois', 'decoration', 'Boucliers pour activités thématiques', 5, NULL),

    -- Crafts / Bricolage
    ('Petite boîte de 10 pinces', 'crafts', 'Pinces pour bricolage', 1, NULL),
    ('Pot d''épingles de sûreté avec anneaux', 'crafts', 'Épingles et anneaux divers', 1, NULL),
    ('Boîte de crayons de cire', 'crafts', 'Crayons pour dessin', 1, NULL),

    -- Storage / Rangement
    ('Bac de costumes', 'storage', 'Costumes variés', 1, NULL)

) AS seed(name, category, description, qty, condition_note)
WHERE NOT EXISTS (
  SELECT 1 FROM equipment_items e
  WHERE e.organization_id = 1 AND e.name = seed.name
);

-- Grant owner access (organization 1 owns these items)
INSERT INTO equipment_item_organizations (equipment_id, organization_id)
SELECT e.id, 1
FROM equipment_items e
WHERE e.organization_id = 1
ON CONFLICT DO NOTHING;

-- Share all organization 1 equipment with organization 2
INSERT INTO equipment_item_organizations (equipment_id, organization_id)
SELECT e.id, 2
FROM equipment_items e
WHERE e.organization_id = 1
ON CONFLICT DO NOTHING;
