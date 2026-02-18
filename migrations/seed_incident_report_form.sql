-- Seed: Standard incident report form template and bilingual translations
-- Based on Association des Scouts du Canada "RAPPORT D'INCIDENT / ACCIDENT" (Revisé 2023)
-- Seeds form into organization_form_formats for all existing organizations
-- Seeds ~100 translation keys into translations table (English + French)

-- ============================================================
-- 1. Seed the incident_report form template for all organizations
-- ============================================================

INSERT INTO organization_form_formats (
  organization_id, form_type, form_structure, display_type,
  display_name, description, category, status, display_context,
  created_at, updated_at
)
SELECT
  o.id,
  'incident_report',
  '{
    "fields": [
      {"type": "infoText", "infoText": "incident_section1_title"},

      {"name": "victim_last_name", "type": "text", "label": "incident_victim_last_name", "required": true},
      {"name": "victim_first_name", "type": "text", "label": "incident_victim_first_name", "required": true},
      {"name": "victim_age", "type": "text", "label": "incident_victim_age", "required": false},
      {"name": "guardian_name", "type": "text", "label": "incident_guardian_name", "required": false, "infoText": "incident_guardian_info"},
      {"name": "victim_address_number", "type": "text", "label": "incident_address_number", "required": false},
      {"name": "victim_address_street", "type": "text", "label": "incident_address_street", "required": false},
      {"name": "victim_address_city", "type": "text", "label": "incident_address_city", "required": false},
      {"name": "victim_address_province", "type": "text", "label": "incident_address_province", "required": false},
      {"name": "victim_address_postal", "type": "text", "label": "incident_address_postal_code", "required": false},
      {"name": "victim_phone_home", "type": "tel", "label": "incident_phone_home", "required": false},
      {"name": "victim_phone_work", "type": "tel", "label": "incident_phone_work", "required": false},
      {"name": "victim_email", "type": "email", "label": "incident_victim_email", "required": false},

      {"type": "infoText", "infoText": "incident_section2_title"},

      {"name": "unit_name", "type": "text", "label": "incident_unit_name", "required": true},
      {"name": "unit_branch", "type": "select", "label": "incident_branch", "required": false, "options": [
        {"value": "", "label": "incident_select_branch"},
        {"value": "castors_hirondelles", "label": "incident_branch_castors"},
        {"value": "louveteaux_exploratrices", "label": "incident_branch_louveteaux"},
        {"value": "aventuriers", "label": "incident_branch_aventuriers"},
        {"value": "eclaireurs_intrepides", "label": "incident_branch_eclaireurs"},
        {"value": "pionniers", "label": "incident_branch_pionniers"},
        {"value": "routiers", "label": "incident_branch_routiers"}
      ]},
      {"name": "district_name", "type": "text", "label": "incident_district", "required": false},
      {"name": "unit_leader_last_name", "type": "text", "label": "incident_unit_leader_last_name", "required": false},
      {"name": "unit_leader_first_name", "type": "text", "label": "incident_unit_leader_first_name", "required": false},
      {"name": "unit_leader_phone", "type": "tel", "label": "incident_unit_leader_phone", "required": false},
      {"name": "unit_leader_email", "type": "email", "label": "incident_unit_leader_email", "required": false},
      {"name": "animator_name", "type": "text", "label": "incident_animator_name", "required": false, "infoText": "incident_animator_if_different"},

      {"type": "infoText", "infoText": "incident_section3_title"},

      {"name": "incident_date", "type": "date", "label": "incident_event_date", "required": true},
      {"name": "incident_time", "type": "text", "label": "incident_event_time", "required": true},
      {"name": "weather_conditions", "type": "text", "label": "incident_weather", "required": false},
      {"name": "activity_nature", "type": "text", "label": "incident_activity_nature", "required": true},
      {"name": "activity_location", "type": "text", "label": "incident_activity_location", "required": true},
      {"name": "exact_incident_location", "type": "text", "label": "incident_exact_location", "required": false},
      {"name": "incident_description", "type": "textarea", "label": "incident_description", "required": true},

      {"type": "infoText", "infoText": "incident_section4_title"},

      {"name": "witness1_last_name", "type": "text", "label": "incident_witness_last_name", "required": false},
      {"name": "witness1_first_name", "type": "text", "label": "incident_witness_first_name", "required": false},
      {"name": "witness1_phone", "type": "tel", "label": "incident_witness_phone", "required": false},
      {"name": "witness1_email", "type": "email", "label": "incident_witness_email", "required": false},
      {"name": "witness2_last_name", "type": "text", "label": "incident_witness_last_name", "required": false},
      {"name": "witness2_first_name", "type": "text", "label": "incident_witness_first_name", "required": false},
      {"name": "witness2_phone", "type": "tel", "label": "incident_witness_phone", "required": false},
      {"name": "witness2_email", "type": "email", "label": "incident_witness_email", "required": false},

      {"type": "infoText", "infoText": "incident_section5_title"},

      {"name": "body_regions", "type": "select", "label": "incident_body_regions", "required": false, "multiple": true, "options": [
        {"value": "head", "label": "incident_region_head"},
        {"value": "face", "label": "incident_region_face"},
        {"value": "neck", "label": "incident_region_neck"},
        {"value": "left_shoulder", "label": "incident_region_left_shoulder"},
        {"value": "right_shoulder", "label": "incident_region_right_shoulder"},
        {"value": "left_arm", "label": "incident_region_left_arm"},
        {"value": "right_arm", "label": "incident_region_right_arm"},
        {"value": "left_hand", "label": "incident_region_left_hand"},
        {"value": "right_hand", "label": "incident_region_right_hand"},
        {"value": "chest", "label": "incident_region_chest"},
        {"value": "abdomen", "label": "incident_region_abdomen"},
        {"value": "upper_back", "label": "incident_region_upper_back"},
        {"value": "lower_back", "label": "incident_region_lower_back"},
        {"value": "left_hip", "label": "incident_region_left_hip"},
        {"value": "right_hip", "label": "incident_region_right_hip"},
        {"value": "left_leg", "label": "incident_region_left_leg"},
        {"value": "right_leg", "label": "incident_region_right_leg"},
        {"value": "left_foot", "label": "incident_region_left_foot"},
        {"value": "right_foot", "label": "incident_region_right_foot"}
      ]},
      {"name": "body_region_details", "type": "textarea", "label": "incident_body_region_details", "required": false},
      {"name": "injury_nature", "type": "select", "label": "incident_injury_nature", "required": false, "multiple": true, "options": [
        {"value": "burn", "label": "incident_nature_burn"},
        {"value": "fall", "label": "incident_nature_fall"},
        {"value": "choking", "label": "incident_nature_choking"},
        {"value": "frostbite", "label": "incident_nature_frostbite"},
        {"value": "bleeding", "label": "incident_nature_bleeding"},
        {"value": "loss_of_consciousness", "label": "incident_nature_loss_consciousness"},
        {"value": "sprain", "label": "incident_nature_sprain"},
        {"value": "abrasion", "label": "incident_nature_abrasion"},
        {"value": "cut", "label": "incident_nature_cut"},
        {"value": "concussion", "label": "incident_nature_concussion"},
        {"value": "fracture", "label": "incident_nature_fracture"},
        {"value": "bruise", "label": "incident_nature_bruise"},
        {"value": "allergic_reaction", "label": "incident_nature_allergic_reaction"},
        {"value": "other", "label": "incident_nature_other"}
      ]},
      {"name": "injury_nature_other", "type": "text", "label": "incident_nature_other_detail", "required": false, "dependsOn": {"field": "injury_nature", "value": "other"}},

      {"type": "infoText", "infoText": "incident_section6_title"},

      {"name": "first_aid_nature", "type": "textarea", "label": "incident_first_aid_nature", "required": false},
      {"name": "care_given_by_name", "type": "text", "label": "incident_care_given_by_name", "required": false},
      {"name": "care_given_by_function", "type": "text", "label": "incident_care_given_by_function", "required": false},
      {"name": "care_time", "type": "text", "label": "incident_care_time", "required": false},
      {"name": "care_respondent_name", "type": "text", "label": "incident_care_respondent_name", "required": false},
      {"name": "parents_notified", "type": "radio", "label": "incident_parents_notified", "required": false, "options": [
        {"value": "yes", "label": "yes"},
        {"value": "no", "label": "no"}
      ]},
      {"name": "parents_notified_time", "type": "text", "label": "incident_parents_notified_time", "required": false, "dependsOn": {"field": "parents_notified", "value": "yes"}},
      {"name": "parents_notified_respondent", "type": "text", "label": "incident_parents_notified_respondent", "required": false, "dependsOn": {"field": "parents_notified", "value": "yes"}},
      {"name": "info_sante_contacted", "type": "radio", "label": "incident_info_sante_contacted", "required": false, "options": [
        {"value": "yes", "label": "yes"},
        {"value": "no", "label": "no"}
      ]},
      {"name": "info_sante_time", "type": "text", "label": "incident_info_sante_time", "required": false, "dependsOn": {"field": "info_sante_contacted", "value": "yes"}},
      {"name": "ambulance_transport", "type": "radio", "label": "incident_ambulance_transport", "required": false, "options": [
        {"value": "yes", "label": "yes"},
        {"value": "no", "label": "no"}
      ]},
      {"name": "doctor_referral", "type": "radio", "label": "incident_doctor_referral", "required": false, "options": [
        {"value": "yes", "label": "yes"},
        {"value": "no", "label": "no"}
      ]},
      {"name": "hospital_doctor_name", "type": "text", "label": "incident_hospital_doctor_name", "required": false},
      {"name": "police_report", "type": "radio", "label": "incident_police_report", "required": false, "options": [
        {"value": "yes", "label": "yes"},
        {"value": "no", "label": "no"}
      ]},
      {"name": "police_corps", "type": "text", "label": "incident_police_corps", "required": false, "dependsOn": {"field": "police_report", "value": "yes"}},
      {"name": "police_dossier_number", "type": "text", "label": "incident_police_dossier_number", "required": false, "dependsOn": {"field": "police_report", "value": "yes"}},
      {"name": "police_officer_name", "type": "text", "label": "incident_police_officer_name", "required": false, "dependsOn": {"field": "police_report", "value": "yes"}},
      {"name": "police_officer_phone", "type": "tel", "label": "incident_police_officer_phone", "required": false, "dependsOn": {"field": "police_report", "value": "yes"}},

      {"type": "infoText", "infoText": "incident_section7_title"},

      {"name": "author_last_name", "type": "text", "label": "incident_author_last_name", "required": true},
      {"name": "author_first_name", "type": "text", "label": "incident_author_first_name", "required": true},
      {"name": "author_function", "type": "text", "label": "incident_author_function", "required": false},
      {"name": "author_phone", "type": "tel", "label": "incident_author_phone", "required": false},
      {"name": "author_email", "type": "email", "label": "incident_author_email", "required": false},
      {"name": "report_date", "type": "date", "label": "incident_report_date", "required": true}
    ]
  }'::jsonb,
  NULL,
  'Incident / Accident Report',
  'Standard incident/accident report form based on Association des Scouts du Canada template (Revised 2023)',
  'safety',
  'published',
  ARRAY['admin_panel']::text[],
  NOW(),
  NOW()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_form_formats off2
  WHERE off2.organization_id = o.id AND off2.form_type = 'incident_report'
);

-- ============================================================
-- 2. Seed English translations (language_id = 1)
-- ============================================================

INSERT INTO translations (language_id, key, value) VALUES
  -- Section titles
  (1, 'incident_section1_title', 'Section 1: Victim / Injured Person Information'),
  (1, 'incident_section2_title', 'Section 2: Unit Information'),
  (1, 'incident_section3_title', 'Section 3: Event Description'),
  (1, 'incident_section4_title', 'Section 4: Witness Identification'),
  (1, 'incident_section5_title', 'Section 5: Injury Description'),
  (1, 'incident_section6_title', 'Section 6: Actions Taken'),
  (1, 'incident_section7_title', 'Section 7: Report Author'),

  -- Section 1: Victim info
  (1, 'incident_victim_last_name', 'Last Name'),
  (1, 'incident_victim_first_name', 'First Name'),
  (1, 'incident_victim_age', 'Age'),
  (1, 'incident_guardian_name', 'Guardian / Respondent Name'),
  (1, 'incident_guardian_info', 'Required for victims under 18 years old'),
  (1, 'incident_address_number', 'Street Number'),
  (1, 'incident_address_street', 'Street'),
  (1, 'incident_address_city', 'City'),
  (1, 'incident_address_province', 'Province'),
  (1, 'incident_address_postal_code', 'Postal Code'),
  (1, 'incident_phone_home', 'Phone (Home)'),
  (1, 'incident_phone_work', 'Phone (Work)'),
  (1, 'incident_victim_email', 'Email'),

  -- Section 2: Unit info
  (1, 'incident_unit_name', 'Unit Name'),
  (1, 'incident_branch', 'Branch'),
  (1, 'incident_select_branch', '-- Select a branch --'),
  (1, 'incident_branch_castors', 'Castors / Hirondelles'),
  (1, 'incident_branch_louveteaux', 'Louveteaux / Exploratrices'),
  (1, 'incident_branch_aventuriers', 'Aventuriers'),
  (1, 'incident_branch_eclaireurs', 'Eclaireurs / Intrepides'),
  (1, 'incident_branch_pionniers', 'Pionniers'),
  (1, 'incident_branch_routiers', 'Routiers'),
  (1, 'incident_district', 'District'),
  (1, 'incident_unit_leader_last_name', 'Unit Leader Last Name'),
  (1, 'incident_unit_leader_first_name', 'Unit Leader First Name'),
  (1, 'incident_unit_leader_phone', 'Unit Leader Phone'),
  (1, 'incident_unit_leader_email', 'Unit Leader Email'),
  (1, 'incident_animator_name', 'Animator Name'),
  (1, 'incident_animator_if_different', 'If different from the unit leader'),

  -- Section 3: Event description
  (1, 'incident_event_date', 'Date of Incident'),
  (1, 'incident_event_time', 'Time of Incident'),
  (1, 'incident_weather', 'Weather Conditions'),
  (1, 'incident_activity_nature', 'Nature of Activity'),
  (1, 'incident_activity_location', 'Activity Location'),
  (1, 'incident_exact_location', 'Exact Location of Incident'),
  (1, 'incident_description', 'Description of Incident'),

  -- Section 4: Witnesses
  (1, 'incident_witness_last_name', 'Witness Last Name'),
  (1, 'incident_witness_first_name', 'Witness First Name'),
  (1, 'incident_witness_phone', 'Witness Phone'),
  (1, 'incident_witness_email', 'Witness Email'),

  -- Section 5: Injury description
  (1, 'incident_body_regions', 'Affected Body Regions'),
  (1, 'incident_region_head', 'Head'),
  (1, 'incident_region_face', 'Face'),
  (1, 'incident_region_neck', 'Neck'),
  (1, 'incident_region_left_shoulder', 'Left Shoulder'),
  (1, 'incident_region_right_shoulder', 'Right Shoulder'),
  (1, 'incident_region_left_arm', 'Left Arm'),
  (1, 'incident_region_right_arm', 'Right Arm'),
  (1, 'incident_region_left_hand', 'Left Hand'),
  (1, 'incident_region_right_hand', 'Right Hand'),
  (1, 'incident_region_chest', 'Chest'),
  (1, 'incident_region_abdomen', 'Abdomen'),
  (1, 'incident_region_upper_back', 'Upper Back'),
  (1, 'incident_region_lower_back', 'Lower Back'),
  (1, 'incident_region_left_hip', 'Left Hip'),
  (1, 'incident_region_right_hip', 'Right Hip'),
  (1, 'incident_region_left_leg', 'Left Leg'),
  (1, 'incident_region_right_leg', 'Right Leg'),
  (1, 'incident_region_left_foot', 'Left Foot'),
  (1, 'incident_region_right_foot', 'Right Foot'),
  (1, 'incident_body_region_details', 'Injury Location Details'),
  (1, 'incident_injury_nature', 'Nature of Injury'),
  (1, 'incident_nature_burn', 'Burn'),
  (1, 'incident_nature_fall', 'Fall'),
  (1, 'incident_nature_choking', 'Choking'),
  (1, 'incident_nature_frostbite', 'Frostbite'),
  (1, 'incident_nature_bleeding', 'Bleeding'),
  (1, 'incident_nature_loss_consciousness', 'Loss of Consciousness'),
  (1, 'incident_nature_sprain', 'Sprain / Strain'),
  (1, 'incident_nature_abrasion', 'Abrasion / Scrape'),
  (1, 'incident_nature_cut', 'Cut'),
  (1, 'incident_nature_concussion', 'Concussion'),
  (1, 'incident_nature_fracture', 'Fracture'),
  (1, 'incident_nature_bruise', 'Bruise'),
  (1, 'incident_nature_allergic_reaction', 'Allergic Reaction'),
  (1, 'incident_nature_other', 'Other'),
  (1, 'incident_nature_other_detail', 'Other (please specify)'),

  -- Section 6: Actions taken
  (1, 'incident_first_aid_nature', 'Nature of First Aid Provided'),
  (1, 'incident_care_given_by_name', 'Care Given By (Name)'),
  (1, 'incident_care_given_by_function', 'Care Given By (Function/Role)'),
  (1, 'incident_care_time', 'Time of Care'),
  (1, 'incident_care_respondent_name', 'Respondent Name'),
  (1, 'incident_parents_notified', 'Parents Notified'),
  (1, 'incident_parents_notified_time', 'Time Parents Were Notified'),
  (1, 'incident_parents_notified_respondent', 'Person Who Notified Parents'),
  (1, 'incident_info_sante_contacted', 'Info-Sante Contacted'),
  (1, 'incident_info_sante_time', 'Time Info-Sante Was Contacted'),
  (1, 'incident_ambulance_transport', 'Transported by Ambulance'),
  (1, 'incident_doctor_referral', 'Referred to a Doctor'),
  (1, 'incident_hospital_doctor_name', 'Hospital / Doctor Name'),
  (1, 'incident_police_report', 'Police Report Filed'),
  (1, 'incident_police_corps', 'Police Department'),
  (1, 'incident_police_dossier_number', 'File Number'),
  (1, 'incident_police_officer_name', 'Officer Name'),
  (1, 'incident_police_officer_phone', 'Officer Phone'),

  -- Section 7: Report author
  (1, 'incident_author_last_name', 'Author Last Name'),
  (1, 'incident_author_first_name', 'Author First Name'),
  (1, 'incident_author_function', 'Author Function / Role'),
  (1, 'incident_author_phone', 'Author Phone'),
  (1, 'incident_author_email', 'Author Email'),
  (1, 'incident_report_date', 'Report Date')
ON CONFLICT (key, language_id) DO NOTHING;

-- ============================================================
-- 3. Seed French translations (language_id = 2)
-- ============================================================

INSERT INTO translations (language_id, key, value) VALUES
  -- Section titles
  (2, 'incident_section1_title', 'Section 1 : Renseignements sur la victime / blesse(e)'),
  (2, 'incident_section2_title', 'Section 2 : Renseignements sur l''unite'),
  (2, 'incident_section3_title', 'Section 3 : Description de l''evenement'),
  (2, 'incident_section4_title', 'Section 4 : Identification des temoins'),
  (2, 'incident_section5_title', 'Section 5 : Description de la blessure'),
  (2, 'incident_section6_title', 'Section 6 : Description des actions prises'),
  (2, 'incident_section7_title', 'Section 7 : Auteur du rapport'),

  -- Section 1: Victim info
  (2, 'incident_victim_last_name', 'Nom'),
  (2, 'incident_victim_first_name', 'Prenom'),
  (2, 'incident_victim_age', 'Age'),
  (2, 'incident_guardian_name', 'Nom du repondant / tuteur'),
  (2, 'incident_guardian_info', 'Requis pour les victimes de moins de 18 ans'),
  (2, 'incident_address_number', 'No civique'),
  (2, 'incident_address_street', 'Rue'),
  (2, 'incident_address_city', 'Ville'),
  (2, 'incident_address_province', 'Province'),
  (2, 'incident_address_postal_code', 'Code postal'),
  (2, 'incident_phone_home', 'Telephone (residence)'),
  (2, 'incident_phone_work', 'Telephone (travail)'),
  (2, 'incident_victim_email', 'Courriel'),

  -- Section 2: Unit info
  (2, 'incident_unit_name', 'Nom de l''unite'),
  (2, 'incident_branch', 'Branche'),
  (2, 'incident_select_branch', '-- Selectionner une branche --'),
  (2, 'incident_branch_castors', 'Castors / Hirondelles'),
  (2, 'incident_branch_louveteaux', 'Louveteaux / Exploratrices'),
  (2, 'incident_branch_aventuriers', 'Aventuriers'),
  (2, 'incident_branch_eclaireurs', 'Eclaireurs / Intrepides'),
  (2, 'incident_branch_pionniers', 'Pionniers'),
  (2, 'incident_branch_routiers', 'Routiers'),
  (2, 'incident_district', 'District'),
  (2, 'incident_unit_leader_last_name', 'Nom du responsable d''unite'),
  (2, 'incident_unit_leader_first_name', 'Prenom du responsable d''unite'),
  (2, 'incident_unit_leader_phone', 'Telephone du responsable'),
  (2, 'incident_unit_leader_email', 'Courriel du responsable'),
  (2, 'incident_animator_name', 'Nom de l''animateur'),
  (2, 'incident_animator_if_different', 'Si different du responsable d''unite'),

  -- Section 3: Event description
  (2, 'incident_event_date', 'Date de l''incident'),
  (2, 'incident_event_time', 'Heure de l''incident'),
  (2, 'incident_weather', 'Conditions atmospheriques'),
  (2, 'incident_activity_nature', 'Nature de l''activite'),
  (2, 'incident_activity_location', 'Lieu de l''activite'),
  (2, 'incident_exact_location', 'Lieu exact de l''incident'),
  (2, 'incident_description', 'Description de l''incident'),

  -- Section 4: Witnesses
  (2, 'incident_witness_last_name', 'Nom du temoin'),
  (2, 'incident_witness_first_name', 'Prenom du temoin'),
  (2, 'incident_witness_phone', 'Telephone du temoin'),
  (2, 'incident_witness_email', 'Courriel du temoin'),

  -- Section 5: Injury description
  (2, 'incident_body_regions', 'Regions du corps affectees'),
  (2, 'incident_region_head', 'Tete'),
  (2, 'incident_region_face', 'Visage'),
  (2, 'incident_region_neck', 'Cou'),
  (2, 'incident_region_left_shoulder', 'Epaule gauche'),
  (2, 'incident_region_right_shoulder', 'Epaule droite'),
  (2, 'incident_region_left_arm', 'Bras gauche'),
  (2, 'incident_region_right_arm', 'Bras droit'),
  (2, 'incident_region_left_hand', 'Main gauche'),
  (2, 'incident_region_right_hand', 'Main droite'),
  (2, 'incident_region_chest', 'Poitrine'),
  (2, 'incident_region_abdomen', 'Abdomen'),
  (2, 'incident_region_upper_back', 'Haut du dos'),
  (2, 'incident_region_lower_back', 'Bas du dos'),
  (2, 'incident_region_left_hip', 'Hanche gauche'),
  (2, 'incident_region_right_hip', 'Hanche droite'),
  (2, 'incident_region_left_leg', 'Jambe gauche'),
  (2, 'incident_region_right_leg', 'Jambe droite'),
  (2, 'incident_region_left_foot', 'Pied gauche'),
  (2, 'incident_region_right_foot', 'Pied droit'),
  (2, 'incident_body_region_details', 'Details sur la localisation de la blessure'),
  (2, 'incident_injury_nature', 'Nature de la blessure'),
  (2, 'incident_nature_burn', 'Brulure'),
  (2, 'incident_nature_fall', 'Chute'),
  (2, 'incident_nature_choking', 'Etouffement'),
  (2, 'incident_nature_frostbite', 'Engelure'),
  (2, 'incident_nature_bleeding', 'Saignement'),
  (2, 'incident_nature_loss_consciousness', 'Perte de conscience'),
  (2, 'incident_nature_sprain', 'Foulure / entorse'),
  (2, 'incident_nature_abrasion', 'Eraflure'),
  (2, 'incident_nature_cut', 'Coupure'),
  (2, 'incident_nature_concussion', 'Commotion'),
  (2, 'incident_nature_fracture', 'Fracture'),
  (2, 'incident_nature_bruise', 'Ecchymose'),
  (2, 'incident_nature_allergic_reaction', 'Reaction allergique'),
  (2, 'incident_nature_other', 'Autres'),
  (2, 'incident_nature_other_detail', 'Autres (veuillez preciser)'),

  -- Section 6: Actions taken
  (2, 'incident_first_aid_nature', 'Nature des premiers soins administres'),
  (2, 'incident_care_given_by_name', 'Soins donnes par (nom)'),
  (2, 'incident_care_given_by_function', 'Soins donnes par (fonction)'),
  (2, 'incident_care_time', 'Heure des soins'),
  (2, 'incident_care_respondent_name', 'Nom du repondant'),
  (2, 'incident_parents_notified', 'Parents avises'),
  (2, 'incident_parents_notified_time', 'Heure d''avis aux parents'),
  (2, 'incident_parents_notified_respondent', 'Personne ayant avise les parents'),
  (2, 'incident_info_sante_contacted', 'Info-Sante contacte'),
  (2, 'incident_info_sante_time', 'Heure de contact Info-Sante'),
  (2, 'incident_ambulance_transport', 'Transporte par ambulance'),
  (2, 'incident_doctor_referral', 'Refere a un medecin'),
  (2, 'incident_hospital_doctor_name', 'Nom de l''hopital / medecin'),
  (2, 'incident_police_report', 'Rapport de police'),
  (2, 'incident_police_corps', 'Corps de police'),
  (2, 'incident_police_dossier_number', 'Numero de dossier'),
  (2, 'incident_police_officer_name', 'Nom du policier'),
  (2, 'incident_police_officer_phone', 'Telephone du policier'),

  -- Section 7: Report author
  (2, 'incident_author_last_name', 'Nom de l''auteur'),
  (2, 'incident_author_first_name', 'Prenom de l''auteur'),
  (2, 'incident_author_function', 'Fonction de l''auteur'),
  (2, 'incident_author_phone', 'Telephone de l''auteur'),
  (2, 'incident_author_email', 'Courriel de l''auteur'),
  (2, 'incident_report_date', 'Date du rapport')
ON CONFLICT (key, language_id) DO NOTHING;
