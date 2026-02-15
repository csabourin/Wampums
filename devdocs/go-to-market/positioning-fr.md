# Positionnement Wampums (FR)

## Thèse de positionnement
Wampums n'est pas une « app de plus ». C'est une plateforme opérationnelle multi-modules qui relie **inscriptions/formulaires**, **suivi santé/médication**, **finances familles** et **logistique terrain** dans un même flux de travail.

Le positionnement proposé pour les décideurs régionaux:

> **Passer d'une gestion fragmentée (fichiers, messages, outils non connectés) à une exécution mesurable et traçable des opérations jeunesse.**

---

## 3 promesses mesurables

## 1) Réduire le temps administratif de coordination
**Promesse:** réduire de **30%** le temps administratif hebdomadaire par équipe locale en 90 jours.

**Indicateurs (KPI):**
- Heures administratives/semaine (avant vs après).
- Délai moyen pour traiter un dossier (inscription + finance + logistique).
- Nombre de relances manuelles envoyées par les équipes.

**Mode de mesure:**
- Baseline 4 semaines avant déploiement.
- Mesure mensuelle par unité/région.
- Cible: -30% à M3.

## 2) Augmenter le taux de formulaires complétés dans les délais
**Promesse:** atteindre **90%** de formulaires critiques complétés avant la date limite (ou +20 points vs baseline en 1 cycle).

**Indicateurs (KPI):**
- Taux de complétion des formulaires critiques.
- Délai médian de soumission.
- % de dossiers incomplets à J-7 d'une activité.

**Mode de mesure:**
- Baseline sur le cycle précédent.
- Mesure par type de formulaire et par activité.
- Cible: 90% dans les délais.

## 3) Diminuer les incidents de suivi santé évitables
**Promesse:** réduire de **50%** les doses manquées/non tracées lors des activités en 2 trimestres.

**Indicateurs (KPI):**
- Taux de doses marquées `missed` / doses planifiées.
- % de doses sans preuve de statut (`given`, `missed`, `cancelled`).
- Nombre d'incidents santé liés à un suivi incomplet.

**Mode de mesure:**
- Baseline trimestrielle.
- Suivi hebdomadaire pendant les camps/activités.
- Cible: -50% sur les doses manquées non justifiées.

---

## Mapping promesses → modules existants

| Promesse | Modules backend (`routes/*.js`) | Modules SPA (`spa/*`) | Valeur opérationnelle |
|---|---|---|---|
| Réduction du temps admin | `routes/forms.js`, `routes/finance.js`, `routes/carpools.js` | `spa/form_permissions.js`, `spa/finance.js`, `spa/carpool_dashboard.js` | Centralise les traitements répétitifs (soumissions, suivi paiements, assignation covoiturage) avec statuts exploitables. |
| Hausse du taux de formulaires complétés | `routes/forms.js` | `spa/formulaire_inscription.js`, `spa/form_permissions.js`, `spa/formBuilder.js` | Structure les formulaires, les permissions et la soumission standardisée pour réduire les dossiers incomplets. |
| Baisse des incidents de suivi santé | `routes/medication.js`, `routes/forms.js` (fiche santé) | `spa/medication_management.js`, `spa/fiche_sante.js`, `spa/medication_reception.js` | Planifie, enregistre et met à jour les distributions de médicaments avec statuts auditable et alertes opérationnelles. |

### Détails de correspondance par promesse

#### Promesse 1 — Temps admin
- **Formulaires**: création/soumission/approbation de formulaires et filtrage par statut dans `routes/forms.js`.
- **Finance**: définitions de frais et génération de frais participants dans `routes/finance.js`, puis pilotage côté `spa/finance.js`.
- **Covoiturage**: offres + assignations + capacité dans `routes/carpools.js`, orchestration dans `spa/carpool_dashboard.js`.

#### Promesse 2 — Formulaires complétés
- `routes/forms.js` gère le cycle de vie (brouillon/soumis/approbation selon type).
- `spa/form_permissions.js` pilote qui peut voir/soumettre/éditer/approuver.
- `spa/formulaire_inscription.js` + `spa/formBuilder.js` permettent la collecte structurée des données terrain.

#### Promesse 3 — Suivi santé
- `routes/medication.js` couvre les exigences, planifications de doses et mises à jour de statuts (`scheduled`, `given`, `missed`, `cancelled`).
- `spa/medication_management.js` apporte une exécution terrain mobile-first avec cache hors-ligne, alertes et flux de distribution.
- Les données santé saisies par formulaire (`fiche_sante`) enrichissent la préparation médication.

---

## Tableau de démonstration “Avant / Après Wampums”

| Dimension | Avant (outils fragmentés) | Après Wampums |
|---|---|---|
| Temps de coordination | Relances manuelles, double saisie, visibilité limitée. | Processus unifiés, statuts normalisés, suivi en temps réel par module. |
| Dossiers formulaires | Pièces manquantes détectées tardivement. | Suivi par statut et permissions, complétion pilotée par échéance. |
| Suivi médication | Notes dispersées, traçabilité incomplète. | Planification + distribution + statut horodaté dans un même flux. |
| Encaissements / frais | Consolidation manuelle, erreurs de rapprochement. | Frais définis, suivi des paiements et encours par participant. |
| Logistique transport | Coordination par messagerie, capacité non fiabilisée. | Offres, places disponibles et assignations visibles instantanément. |
| Pilotage régional | Peu d'indicateurs homogènes entre unités. | KPI communs (temps admin, complétion, incidents évités) comparables. |

---

## Version 1 page — « Pourquoi changer si on a déjà une app? »

## Message clé (décideurs régionaux)
Avoir une app ne garantit pas de meilleurs résultats. Ce qui compte, c'est la capacité à **exécuter** les opérations critiques avec des données fiables et des indicateurs comparables entre unités.

## Ce qui ne fonctionne pas avec une app « générique »
- Les données restent en silos (formulaires, santé, finances, transport séparés).
- Les équipes compensent par des messages, tableurs et relances manuelles.
- Les risques opérationnels persistent (dossiers incomplets, suivi santé incertain, manque de visibilité régionale).

## Ce qui change avec Wampums
- **Chaîne complète**: inscription → autorisations → santé → finance → logistique.
- **Traçabilité exploitable**: chaque étape produit un statut mesurable.
- **Vue régionale**: mêmes KPI dans toutes les unités pour arbitrer et prioriser.

## Impact attendu en 90 jours (pilote)
- -30% de temps admin hebdomadaire.
- 90% de formulaires critiques complétés dans les délais.
- -50% de doses manquées/non tracées en contexte activité.

## Plan de mise en œuvre recommandé
1. Pilote 2-3 unités (6 à 8 semaines).
2. Baseline + cibles KPI validées avant lancement.
3. Revue mensuelle des résultats.
4. Déploiement progressif régional avec standardisation des pratiques.

## Décision à prendre
Ne pas remplacer « une app » par une autre: **standardiser un système d'exécution régional** orienté résultats, mesurable et sécuritaire.
