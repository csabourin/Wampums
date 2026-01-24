-- Seed badge templates for "Territoires de Chasse" (6 hunting territory badges)
-- These badges correspond to the Jungle Book characters and their virtues

-- Insert the 6 territoire badges for each organization
-- Organization 1
INSERT INTO badge_templates (
  organization_id,
  template_key,
  name,
  translation_key,
  section,
  level_count,
  levels,
  image
) VALUES
  (1, 'debrouillard_comme_kaa', 'Débrouillard comme Kaa', 'badge_template_debrouillard_comme_kaa', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'kaa.webp'),
  
  (1, 'vrai_comme_baloo', 'Vrai comme Baloo', 'badge_template_vrai_comme_baloo', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'baloo.webp'),
  
  (1, 'respectueux_comme_rikki_tikki_tavi', 'Respectueux comme Rikki Tikki Tavi', 'badge_template_respectueux_comme_rikki_tikki_tavi', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'rikki.webp'),
  
  (1, 'dynamique_comme_bagheera', 'Dynamique comme Bagheera', 'badge_template_dynamique_comme_bagheera', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'bagheera.webp'),
  
  (1, 'heureux_comme_ferao', 'Heureux comme Ferao', 'badge_template_heureux_comme_ferao', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'ferao.webp'),
  
  (1, 'solidaire_comme_frere_gris', 'Solidaire comme Frère Gris', 'badge_template_solidaire_comme_frere_gris', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'frereGris.webp')
ON CONFLICT DO NOTHING;

-- Organization 2
INSERT INTO badge_templates (
  organization_id,
  template_key,
  name,
  translation_key,
  section,
  level_count,
  levels,
  image
) VALUES
  (2, 'debrouillard_comme_kaa', 'Débrouillard comme Kaa', 'badge_template_debrouillard_comme_kaa', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'kaa.webp'),
  
  (2, 'vrai_comme_baloo', 'Vrai comme Baloo', 'badge_template_vrai_comme_baloo', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'baloo.webp'),
  
  (2, 'respectueux_comme_rikki_tikki_tavi', 'Respectueux comme Rikki Tikki Tavi', 'badge_template_respectueux_comme_rikki_tikki_tavi', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'rikki.webp'),
  
  (2, 'dynamique_comme_bagheera', 'Dynamique comme Bagheera', 'badge_template_dynamique_comme_bagheera', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'bagheera.webp'),
  
  (2, 'heureux_comme_ferao', 'Heureux comme Ferao', 'badge_template_heureux_comme_ferao', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'ferao.webp'),
  
  (2, 'solidaire_comme_frere_gris', 'Solidaire comme Frère Gris', 'badge_template_solidaire_comme_frere_gris', 'general', 3, 
   '[{"level": 1, "label_key": "badge_level_1"}, {"level": 2, "label_key": "badge_level_2"}, {"level": 3, "label_key": "badge_level_3"}]'::jsonb, 
   'frereGris.webp')
ON CONFLICT DO NOTHING;
