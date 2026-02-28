-- Create first_aid_supplies table
CREATE TABLE IF NOT EXISTS public.first_aid_supplies (
  id serial NOT NULL,
  organization_id integer NOT NULL,
  name character varying(200) NOT NULL,
  description text,
  administrable_medication boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT first_aid_supplies_pkey PRIMARY KEY (id),
  CONSTRAINT first_aid_supplies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

-- PDF A: Autorisation de traitement
CREATE TABLE IF NOT EXISTS public.medication_treatment_authorizations (
  id serial NOT NULL,
  organization_id integer NOT NULL,
  participant_id integer NOT NULL,
  guardian_id integer NOT NULL,
  
  -- Consents
  autorise_gestes_securite_bien_etre boolean DEFAULT false,
  accepte_soins_medicaux_urgence boolean DEFAULT false,
  autorise_transmission_fiche_medicale boolean DEFAULT false,
  reconnait_responsabilite_aviser_changements_sante boolean DEFAULT false,
  
  -- Signature info
  signature_parent_tuteur text,
  nom_en_caractere_d_imprimerie character varying(200),
  date_signature timestamp with time zone,
  signature_type character varying(50) DEFAULT 'drawn',
  
  status character varying(50) DEFAULT 'signed',
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT medication_treatment_authorizations_pkey PRIMARY KEY (id),
  CONSTRAINT mta_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT mta_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE,
  CONSTRAINT mta_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id) ON DELETE RESTRICT,
  CONSTRAINT mta_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL
);

-- PDF A: Autorisation de traitement -> items mapping
CREATE TABLE IF NOT EXISTS public.medication_treatment_authorization_supplies (
  authorization_id integer NOT NULL,
  first_aid_supply_id integer NOT NULL,
  is_allowed boolean DEFAULT false,
  
  CONSTRAINT mtas_pkey PRIMARY KEY (authorization_id, first_aid_supply_id),
  CONSTRAINT mtas_authorization_id_fkey FOREIGN KEY (authorization_id) REFERENCES public.medication_treatment_authorizations(id) ON DELETE CASCADE,
  CONSTRAINT mtas_first_aid_supply_id_fkey FOREIGN KEY (first_aid_supply_id) REFERENCES public.first_aid_supplies(id) ON DELETE CASCADE
);

-- PDF B: Autorisation d'administration de medicaments (Parent level)
CREATE TABLE IF NOT EXISTS public.medication_admin_authorizations (
  id serial NOT NULL,
  organization_id integer NOT NULL,
  participant_id integer NOT NULL,
  guardian_id integer NOT NULL,
  
  admin_user_id_1 uuid,
  admin_user_id_2 uuid,
  
  -- Attestations
  deja_pris_a_la_maison boolean DEFAULT false,
  remettre_contenant_origine boolean DEFAULT false,
  etiquette_pharmacie_et_avis boolean DEFAULT false,
  reconnait_risques_et_accepte boolean DEFAULT false,
  
  -- Signature info
  nom_parent_ou_tuteur_legal character varying(200),
  signature_parent_ou_tuteur_legal text,
  date_signature timestamp with time zone,
  signature_type character varying(50) DEFAULT 'drawn',
  
  status character varying(50) DEFAULT 'signed',
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT medication_admin_authorizations_pkey PRIMARY KEY (id),
  CONSTRAINT maa_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT maa_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE,
  CONSTRAINT maa_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.parents_guardians(id) ON DELETE RESTRICT,
  CONSTRAINT maa_admin_user_id_1_fkey FOREIGN KEY (admin_user_id_1) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT maa_admin_user_id_2_fkey FOREIGN KEY (admin_user_id_2) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT maa_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL
);

-- PDF B: Autorisation d'administration -> items mapping (linking to existing medication_requirements)
CREATE TABLE IF NOT EXISTS public.medication_admin_authorization_requirements (
  authorization_id integer NOT NULL,
  medication_requirement_id integer NOT NULL,
  initiales character varying(20),
  
  CONSTRAINT maar_pkey PRIMARY KEY (authorization_id, medication_requirement_id),
  CONSTRAINT maar_authorization_id_fkey FOREIGN KEY (authorization_id) REFERENCES public.medication_admin_authorizations(id) ON DELETE CASCADE,
  CONSTRAINT maar_medication_requirement_id_fkey FOREIGN KEY (medication_requirement_id) REFERENCES public.medication_requirements(id) ON DELETE CASCADE
);

-- Default seeds for first aid supplies
INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Bénadryl', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Bénadryl')
ON CONFLICT DO NOTHING;

INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Gravol', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Gravol')
ON CONFLICT DO NOTHING;

INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Produit pour brûlure', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Produit pour brûlure')
ON CONFLICT DO NOTHING;

INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Crème solaire', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Crème solaire')
ON CONFLICT DO NOTHING;

INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Polysporin', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Polysporin')
ON CONFLICT DO NOTHING;

INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Tylenol', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Tylenol')
ON CONFLICT DO NOTHING;

INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Advil', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Advil')
ON CONFLICT DO NOTHING;

INSERT INTO public.first_aid_supplies (organization_id, name, administrable_medication)
SELECT id, 'Épipen (en cas d''allergies graves imprévues)', true FROM organizations WHERE id NOT IN (SELECT organization_id FROM first_aid_supplies WHERE name = 'Épipen (en cas d''allergies graves imprévues)')
ON CONFLICT DO NOTHING;
