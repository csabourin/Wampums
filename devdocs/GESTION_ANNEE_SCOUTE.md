# Gestion de l'année scoute — proposition d'architecture

**Statut :** phases 1 à 5 implémentées, plus les tanières annuelles, la lecture seule visuelle et le droit à l'effacement — restent les frais, l'alumni, le transfert et la conservation
**Date :** 2026-08-01

> **Décisions prises :** vue de compatibilité (§4.2) ; parents sans enfant passés à
> `inactive` par défaut (§4.5) ; formulaires conservés avec un drapeau
> « à réviser » plutôt que remis à zéro (§10) ; **annulation possible tant que la
> nouvelle année est vide**, sans fenêtre de temps (§8.3).
>
> **Livré :** `migrations/create_scout_years_and_enrollments.sql`,
> `services/scoutYear.js`, `routes/scoutYears.js`, helpers `getScoutYear` /
> `getScoutYearId` / `withScoutYear` dans `middleware/auth.js`,
> `spa/modules/scout-year/` (assistant, contexte d'année, bandeau d'archives).
> Voir §9 pour l'état exact.

---

## 1. Le problème

À chaque rentrée, une unité doit :

- faire monter les jeunes qui ont atteint l'âge limite (12 ans avant décembre) vers la section suivante ;
- repartir à zéro pour les points, les présences, les honneurs ;
- désactiver les parents qui n'ont plus d'enfant inscrit ;
- **sans jamais rien supprimer** — on veut pouvoir retrouver un ancien jeune ou un ancien parent en consultant une année antérieure ;
- avec une étape de vérification, pour ne pas sortir un jeune qui reste exceptionnellement ;
- le tout avec le moins de friction possible.

## 2. Ce que la structure actuelle permet (et ne permet pas)

| Élément | État actuel | Problème pour la transition d'année |
|---|---|---|
| `participant_organizations` | (participant_id, organization_id, inscription_date), PK sur les deux premiers | Pas d'année, pas de statut, pas de date de fin. Un jeune est inscrit ou n'existe plus dans l'unité. |
| `participants` | Pas de `organization_id`, pas de `is_active` | ✅ La personne survit déjà à la sortie de l'unité. |
| `points` | Journal d'événements (`created_at`), pas d'année | « Réinitialiser » = supprimer des lignes. Perte d'historique. |
| `attendance`, `honors` | Datés | ✅ Filtrables par plage de dates. |
| `participant_groups` | PK (participant_id, organization_id) | Une seule sixaine, aucun historique. |
| `user_organizations` | (user_id, organization_id, role_ids) | Aucun statut : impossible de « désactiver » un parent sans le retirer, donc sans le perdre. |
| `organization_settings` | Réglage `fiscal_year` `{start_month:9, start_day:1}` | ✅ Base existante pour calculer les bornes d'année. |

**Volumétrie du changement :** `participant_organizations` est jointe à 85 endroits dans `routes/`, mais écrite à 5 seulement (`import.js:272`, `participants.js:286`, `participants.js:619`, `participants.js:803`, `participants.js:1329`).

## 3. Principe directeur

> **Rien n'est supprimé. Ce qui change, c'est l'année à laquelle on regarde.**

L'année scoute devient une dimension de première classe. « Réinitialiser les points » ne veut plus dire *effacer* : ça veut dire *changer d'année*, et les totaux de la nouvelle année partent naturellement à zéro pendant que ceux de l'an dernier restent consultables.

Corollaire : la transition d'année est **réversible**. C'est ce qui autorise le « sans friction » — on peut se permettre un assistant à un clic parce qu'une erreur s'annule.

## 4. Modèle de données proposé

### 4.1 Table `scout_years`

```sql
CREATE TABLE scout_years (
  id              serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  label           text NOT NULL,           -- '2026-2027'
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  status          text NOT NULL DEFAULT 'planning'
                  CHECK (status IN ('planning','active','closed')),
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now(),
  UNIQUE (organization_id, label)
);

-- Une seule année active par organisation
CREATE UNIQUE INDEX scout_years_one_active
  ON scout_years (organization_id) WHERE status = 'active';
```

Les bornes sont calculées depuis le réglage `fiscal_year` existant, modifiables à la main.

### 4.2 Inscriptions annuelles + vue de compatibilité

C'est la pièce maîtresse. On transforme la table d'appartenance en table d'inscriptions annuelles, et on recrée une **vue** portant l'ancien nom, filtrée sur l'année active :

```sql
ALTER TABLE participant_organizations RENAME TO participant_enrollments;

ALTER TABLE participant_enrollments
  ADD COLUMN scout_year_id integer REFERENCES scout_years(id),
  ADD COLUMN status text NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','graduated','left','transferred')),
  ADD COLUMN ended_on date,
  ADD COLUMN exit_reason text,
  ADD COLUMN exception_note text,          -- « reste malgré l'âge : ... »
  ADD COLUMN transferred_to_organization_id integer REFERENCES organizations(id);

-- Nouvelle PK
ALTER TABLE participant_enrollments DROP CONSTRAINT participant_organizations_pkey;
ALTER TABLE participant_enrollments
  ADD PRIMARY KEY (participant_id, organization_id, scout_year_id);

CREATE VIEW participant_organizations AS
  SELECT pe.participant_id, pe.organization_id, pe.inscription_date
  FROM participant_enrollments pe
  JOIN scout_years sy ON sy.id = pe.scout_year_id
  WHERE sy.status = 'active' AND pe.status = 'active';
```

**Effet :** les 85 jointures existantes continuent de fonctionner sans modification, et signifient désormais « l'effectif de l'année courante ». Seuls les 5 sites d'écriture doivent être réécrits vers `participant_enrollments` (une vue sur jointure n'est pas modifiable dans PostgreSQL — c'est voulu, ça force l'explicite en écriture).

Ensuite, on rend *progressivement* explicites les endpoints où l'année a du sens (effectif, points, présences, honneurs, rapports, tableaux de bord), via un paramètre `?scout_year_id=`. Le reste continue de tourner sur l'année active.

### 4.3 Points

```sql
ALTER TABLE points ADD COLUMN scout_year_id integer REFERENCES scout_years(id);
CREATE INDEX points_year_idx ON points (organization_id, scout_year_id, participant_id);
```

Backfill par plage de dates, puis colonne obligatoire à l'insertion. Les totaux sont toujours calculés `WHERE scout_year_id = <année consultée>`. **Aucune ligne n'est jamais supprimée** ; le « reset » est un effet de bord du changement d'année.

Pour `attendance` et `honors`, pas de nouvelle colonne : ils sont intrinsèquement datés, on joint sur `scout_years.start_date/end_date`. (Décision à valider — voir §8.)

### 4.4 Sixaines annuelles

Même traitement que les inscriptions :

```sql
ALTER TABLE participant_groups ADD COLUMN scout_year_id integer REFERENCES scout_years(id);
-- PK → (participant_id, organization_id, scout_year_id)
```

Les sixaines (`groups`) survivent d'une année à l'autre ; les affectations et les rôles de sizainier/second sont remis à plat chaque année, avec l'option « reconduire les affectations de l'an dernier » dans l'assistant.

### 4.5 Statut des comptes parents

```sql
ALTER TABLE user_organizations
  ADD COLUMN status text NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','inactive','alumni')),
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN deactivated_reason text,
  ADD COLUMN last_active_scout_year_id integer REFERENCES scout_years(id);
```

Trois états, et la distinction compte :

- **active** — accès normal ;
- **inactive** — plus d'accès à l'unité, mais le compte, les liens `guardian_users` / `participant_guardians` et tout l'historique restent intacts ; retrouvable en consultant une année antérieure ; réactivable en un clic si l'enfant revient ;
- **alumni** — variante optionnelle : pas d'accès aux données de l'unité, mais reste joignable pour les communications de type « nouvelles du groupe » (utile pour le lien que tu veux garder).

**Points de vigilance dans le code :**

1. `middleware/auth.js:240` vérifie l'appartenance à l'organisation → doit rejeter `status <> 'active'` avec un message clair (« votre compte n'est plus rattaché à cette unité »), et non un 403 générique.
2. Le chargement des permissions (`auth.js:322`) et des rôles (`auth.js:338`) doit filtrer sur `status = 'active'`.
3. `routes/announcements.js:86,148` — ne pas envoyer aux comptes inactifs (sauf ciblage « alumni » explicite).
4. **Ne jamais désactiver un utilisateur qui détient un rôle non-parent** (animateur, admin, trésorier) dans l'unité. Règle absolue de l'assistant.

### 4.6 Journal des transitions (le filet de sécurité)

```sql
CREATE TABLE scout_year_transitions (
  id                serial PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations(id),
  from_scout_year_id integer REFERENCES scout_years(id),
  to_scout_year_id   integer NOT NULL REFERENCES scout_years(id),
  executed_at       timestamptz NOT NULL DEFAULT now(),
  executed_by       uuid NOT NULL REFERENCES users(id),
  summary           jsonb NOT NULL,   -- compteurs affichés dans le rapport
  changeset         jsonb NOT NULL,   -- tout ce qui a changé, pour l'annulation
  rolled_back_at    timestamptz,
  rolled_back_by    uuid REFERENCES users(id)
);
```

`changeset` contient la liste exacte des inscriptions créées/clôturées, des comptes désactivés, des affectations de sixaines — assez pour rejouer l'inverse. Annulation possible tant que la nouvelle année n'a pas de données saisies (ou dans une fenêtre de N jours, au choix).

## 5. L'assistant de transition

Route SPA : `spa/modules/scout-year/`. Permission : `scout_year.manage` (nouvelle), sinon `organization.manage`.

### Étape 1 — Prévisualisation de l'effectif

`GET /api/v1/scout-years/transition/preview`

Le serveur propose une disposition pour **chaque** jeune :

| Disposition | Règle |
|---|---|
| `graduating` | atteint l'âge limite avant la date pivot |
| `returning` | tout le reste |

Affichage : les sortants en premier, cases déjà cochées, un bouton **« Tout accepter »**. Pour chaque sortant, une bascule « reste exceptionnellement » qui demande une note courte (facultative) et le reclasse en `returning` avec `exception_note`. Pour chaque montant, option « transféré vers → <unité> » si l'organisation a des unités sœurs (`organization_local_groups` existe déjà).

Le cas nominal, c'est : ouvrir, survoler la liste, cliquer une fois. La vérification que tu demandes est là, mais elle ne coûte rien quand il n'y a pas d'exception.

### Étape 2 — Conséquences

Calculées à partir des choix de l'étape 1, chacune débrayable :

- **N comptes parents à désactiver** — liste nominative, avec la raison (« plus d'enfant inscrit »), décochable individuellement. Les parents qui sont aussi animateurs sont exclus automatiquement et signalés.
- **Points** — « les totaux de 2025-2026 sont archivés (aperçu du classement final), la nouvelle année démarre à zéro ».
- **Sixaines** — remettre à plat / reconduire les affectations.
- **Fiches santé et inscriptions** — marquer à renouveler (voir §6).
- **Animateurs** — liste de l'équipe pour revue manuelle : qui part, qui reste. Pas d'automatisme ici, c'est trop sensible.

### Étape 3 — Confirmation

Un seul écran récapitulatif, une transaction unique côté serveur. `POST /api/v1/scout-years/transition`.

### Étape 4 — Rapport

Compteurs, lien d'export, et un bouton **« Annuler cette transition »** bien visible. `POST /api/v1/scout-years/transitions/:id/rollback`.

### Configuration de la règle d'âge

Réglage `year_transition` dans `organization_settings` :

```json
{
  "max_age": 12,
  "age_reference_date": "12-31",
  "auto_graduate": true,
  "min_age": 7
}
```

`age_reference_date` = 31 décembre de l'année civile où démarre l'année scoute — c'est ta règle « 12 ans ou l'auront avant décembre ». Les bornes doivent pouvoir varier par section (louveteaux 7-11, éclaireurs 12-14), donc le réglage est per-organisation, chaque organisation ayant déjà son `program_section`.

## 6. Ce à quoi il faut penser aussi

Ta liste couvre l'essentiel ; voici ce qui viendrait mordre plus tard.

**À traiter dans la transition :**

- **Fiches santé / formulaires d'inscription** (`form_submissions`) — allergies, contacts d'urgence, autorisations : ces données **périment** et doivent être re-collectées chaque année. C'est le plus important des oubliés, à la fois pour la sécurité et pour la conformité. Ajouter `scout_year_id` à `form_submissions` et un état « à renouveler » sur le tableau de bord parent.
- **Autorisations médicales** (`medication_treatment_authorizations`, `participant_medications`) — expirent avec l'année, doivent être re-signées.
- **Frais et paiements** (`participant_fees`, `payment_plans`) — nouveau cycle de cotisation ; les soldes impayés de l'an dernier ne doivent pas disparaître de la vue du trésorier.
- **Rôles de sixaine** (`first_leader`, `second_leader`) — remis à zéro.
- **Abonnements push** (`subscribers`) des familles parties — à purger, sinon elles reçoivent les notifications de l'unité.
- **`year_plans`** (planificateur annuel, déjà doté d'un `is_active`) — à rattacher au `scout_year_id` plutôt que de vivre en parallèle.

**À ne PAS réinitialiser (acquis cumulatifs) :**

- **Badges** (`badge_progress`) et **progression OAS** (`participant_oas_competency`, `participant_oas_stage_award`, `participant_top_award_progress`) — un badge obtenu reste obtenu. Question ouverte : les progressions *en cours* se reportent-elles à l'année suivante ? (Oui, à mon avis, mais à confirmer.)

**Transverses :**

- **Sélecteur d'année dans l'interface** — un menu dans l'en-tête. Consulter une année close bascule l'app en **lecture seule** avec un bandeau explicite (« Vous consultez 2024-2025 — archives »). C'est le mécanisme par lequel tu « retrouves » un ancien jeune ou un ancien parent.
- **Rapports et exports** — doivent tous porter l'année consultée, et exclure les archives par défaut.
- **Loi 25 / conservation** — garder indéfiniment les coordonnées de familles parties demande une politique de conservation explicite (durée, purge, mention dans la politique de confidentialité). Un réglage `data_retention_years` et une purge assistée seraient à prévoir, même si ce n'est pas dans la première livraison. C'est le pendant juridique du « on ne supprime rien ».

## 7. Découpage en phases

| Phase | Contenu | Utilisable seule ? |
|---|---|---|
| **1. Socle** | `scout_years`, `participant_enrollments` + vue de compatibilité, réécriture des 5 sites d'écriture, backfill de l'année en cours, helper `getScoutYearId(req, pool)` | Oui — aucun changement visible, mais tout le reste en dépend |
| **2. Points annuels** | `points.scout_year_id`, backfill, filtrage des totaux | Oui — le « reset » devient possible manuellement |
| **3. Statut des comptes** | `user_organizations.status`, application dans `auth.js` et `announcements.js`, écran d'activation/désactivation manuelle | Oui |
| **4. Assistant** | Preview / execute / rollback + module SPA + `scout_year_transitions` | C'est la livraison qui rend le tout « sans friction » |
| **5. Consultation historique** | Sélecteur d'année, mode lecture seule, endpoints year-aware (rapports, tableaux de bord) | C'est ce qui sert le « garder contact » |
| **6. Renouvellements** | `form_submissions.scout_year_id`, fiches santé et autorisations à renouveler, cycle de frais | Peut suivre |

Les phases 1 à 3 sont surtout de la migration SQL et des ajustements ciblés. La phase 4 est la plus grosse en volume d'interface. La phase 5 est celle qui touche le plus de fichiers (les endpoints de lecture, un par un), mais elle est incrémentale et sans risque grâce à la vue de compatibilité.

## 8. Décisions restantes

1. ~~Parents sans enfant : `inactive` ou `alumni` ?~~ → **`inactive`** par défaut. Les trois statuts existent en base ; `alumni` est disponible mais aucun automatisme ne l'attribue.
2. **Présences et honneurs : colonne `scout_year_id` ou filtrage par plage de dates ?** → **filtrage par plage de dates**, appliqué en lecture (§9). Les deux tables portent déjà une date ; les endpoints la bornent maintenant sur `scout_years.start_date/end_date`, ce qui règle le décompte d'honneurs qui traversait les années. Reste ouvert le seul cas que la plage de dates ne tranche pas : une saisie **rétroactive** faite après la transition mais datée de l'an dernier compte dans l'année précédente, ce qui est correct pour la consultation mais empêche l'annulation (elle est comptée comme activité). Une colonne `scout_year_id` lèverait l'ambiguïté ; elle n'est pas nécessaire pour l'usage courant.
3. ~~**Portée du rollback :** indéfiniment tant que la nouvelle année est vide, ou fenêtre de N jours ?~~ → **tant que la nouvelle année est vide**, sans limite de temps. Le refus est nominatif : il nomme ce qui a été saisi depuis (§9).
4. **Progressions de badges/OAS en cours :** se reportent à la nouvelle année, ou repartent à zéro avec l'historique conservé ? Aucun changement fait : elles se reportent (comportement actuel).
5. **Transfert vers une unité sœur :** la colonne `transferred_to_organization_id` existe, aucune interface ne l'alimente. **Décidé, pas implémenté :** le transfert doit emmener les parents avec le jeune ; si un parent a d'autres enfants dans d'autres unités, il obtient une adhésion à chacune plutôt qu'un déplacement, et ne voit dans chaque vue que l'enfant qui y est inscrit — ce dernier point fonctionne déjà, la liste des participants d'un parent est filtrée par organisation. La fonction vivra dans l'espace district.
6. ~~**Tanières d'une année à l'autre ?**~~ → **remises à zéro**, avec historique par année (§9). Les tanières elles-mêmes gardent leur nom ; ce sont les affectations et les rôles de sizainier qui repartent de zéro chaque septembre. Pas de suivi des changements *en cours* d'année : ce qui compte est l'état à la fin de l'année.
7. ~~**Effacement à la demande : jusqu'où ?**~~ → **le jeune, plus les parents qui n'ont plus aucun autre enfant** ; trace d'audit sans données personnelles ; réservé aux administrateurs d'unité et au district (§9).
8. **Statut alumni — conception validée, pas implémentée.** Jamais automatique : la transition continue de poser `inactive`. Le consentement se demande au départ, par un courriel avec un lien à un clic (jeton signé, sans connexion, puisque l'accès vient d'être retiré) ; le silence laisse `inactive`. `alumni` débloque une audience distincte dans les annonces, **jamais incluse dans un envoi général**, avec désabonnement à un clic. C'est aussi l'ancrage de la future politique de conservation : une famille sans consentement et sans enfant inscrit devient candidate à la purge, un alumni consentant a une relation active qui justifie qu'on garde ses coordonnées.

---

## 9. État d'implémentation

### Fait

**Base de données** — `migrations/create_scout_years_and_enrollments.sql`, transactionnel et ré-exécutable :

- `scout_years` (une seule année active par organisation, contrainte d'exclusion `btree_gist` contre le chevauchement) ;
- fonction `scout_year_for_date()` dérivant les bornes du réglage `fiscal_year` existant ;
- **historique amorcé** : les années sont créées depuis la plus ancienne trace d'activité de l'unité jusqu'à aujourd'hui, toutes `closed` sauf l'année courante ;
- `participant_organizations` renommée `participant_enrollments` (+ `scout_year_id`, `status`, `ended_on`, `exit_reason`, `exception_note`, `transferred_to_organization_id`), PK à trois colonnes ;
- **vue `participant_organizations`** filtrée sur l'année active : les 85 jointures existantes fonctionnent sans modification ;
- `points.scout_year_id` + rétro-remplissage par date + trigger `points_set_scout_year_trigger` qui estampille tout insert (les 8 sites d'écriture restent inchangés, les imports et le SQL manuel sont couverts aussi) ;
- **vue `active_year_points`** pour les agrégats « score de la saison » ;
- `user_organizations.status` (`active` / `inactive` / `alumni`) + `deactivated_at`, `deactivated_reason`, `last_active_scout_year_id` ;
- `scout_year_transitions` (journal + `changeset` JSONB pour une annulation future) ;
- permissions `scout_year.view` et `scout_year.manage`.

La migration **ne supprime jamais de ligne** : si une inscription ne peut être rattachée à une année, elle lève une exception et annule tout plutôt que d'effacer.

**Invariant clé** — l'année active contient toujours aujourd'hui. `openNextScoutYear` ramène la date de début à aujourd'hui quand la transition est lancée en avance (les points du 26 au 31 août tombent alors dans la nouvelle année, pas dans celle qu'on vient de fermer) et ré-estampille les points déjà attribués quand elle est lancée en retard.

**Backend**

- `services/scoutYear.js` : bornes d'année, année active, ouverture de l'année suivante, détection des comptes sans enfant inscrit ;
- `middleware/auth.js` : `getScoutYear(req, pool)` / `getScoutYearId(req, pool)` (paramètre `?scout_year_id=` ou en-tête `x-scout-year-id`), et **statut de membership appliqué** dans `requirePermission`, `requireOrganizationRole` et `getUserDataScope` ;
- `routes/auth.js` : connexion et validation 2FA refusent un membership non actif avec `membership_inactive` ;
- `routes/announcements.js` : les comptes désactivés ne reçoivent plus courriels ni notifications push ;
- `routes/scoutYears.js` monté sur `/api/v1/scout-years` :
  - `GET /` — historique des années,
  - `GET /active` — année active,
  - `GET /transition/preview` — **l'étape de vérification** : disposition proposée pour chaque jeune, comptes parents concernés, aucun effet de bord,
  - `POST /transition` — exécution en une transaction, avec exceptions nominatives,
  - `GET /memberships/without-child`, `PATCH /memberships/:id/status` — contrôle manuel, réactivation incluse ;
- les 5 sites d'écriture pointent sur `participant_enrollments` ; `DELETE /api/v1/participants/:id` **ferme** l'inscription (`status = 'left'`) au lieu de supprimer ;
- les agrégats de points lisent `active_year_points`, et les requêtes qui énumèrent une sixaine sont jointes à l'effectif pour ne plus compter ni récompenser un jeune parti.

**Garde-fous de la transition** — un compte portant un rôle non-parent (animateur, admin) n'est jamais désactivé, quoi qu'envoie le client : la règle est dans le `UPDATE` lui-même, pas seulement dans l'interface. Un jeune sans date de naissance n'est jamais sorti automatiquement, il est marqué `needs_review`.

**Vérification** — migration exécutée et ré-exécutée sur un PostgreSQL 16 jetable, transition complète jouée bout en bout contre les vraies routes (28 assertions), suite du projet à 815 tests verts, 8 scripts de lint au vert.

**Interface** — `spa/modules/scout-year/ScoutYearTransition.js`, route `/scout-year`, accessible depuis les réglages de l'unité :

- assistant en trois écrans (effectif → conséquences → confirmation) puis rapport ;
- les jeunes qui demandent une décision remontent en haut de liste — sortants d'abord, puis ceux que la règle d'âge n'a pas pu juger, puis la majorité qu'on ne touche pas ;
- une bascule par jeune pour le garder par exception, avec champ de note qui apparaît seulement dans ce cas ;
- l'écran des conséquences **redemande une prévisualisation** avec les dispositions réellement choisies (`?graduating_ids=`), donc la liste des parents touchés n'est jamais périmée ;
- chaque parent proposé est décochable individuellement ; un dialogue de confirmation précède l'exécution ;
- historique des années visible même sans la permission de gestion ;
- `css/scout-year.css`, mobile-first, cibles tactiles à 44 px ; 47 clés de traduction ajoutées dans `en.json` et `fr.json`.

11 tests jsdom couvrent le parcours : pré-sélection par la règle d'âge, jeune sans date de naissance signalé et jamais sorti d'office, exception avec note, recalcul des parents, contenu exact de la charge utile envoyée, annulation du dialogue et échec serveur qui laisse l'animateur sur l'écran de confirmation.

**Annulation d'une transition** — `POST /api/v1/scout-years/transitions/:id/rollback`, plus
`GET /api/v1/scout-years/transitions` pour l'historique :

- le `changeset` est rejoué à l'envers : les inscriptions créées dans la nouvelle année sont
  supprimées, celles qui avaient été clôturées redeviennent actives, les comptes désactivés sont
  réactivés, les drapeaux « à réviser » sont retirés et les autorisations médicales repassent à
  `signed`. `last_reviewed_at` n'est **pas** touché : il enregistre un fait sur le parent, pas sur
  la transition ;
- **portée** : possible tant que la nouvelle année est vide. Le refus est un 409 qui **nomme** ce
  qui bloque, avec un compte — points attribués, présences prises, honneurs remis, jeunes inscrits,
  formulaires remplis, fiches révisées par un parent, autorisations signées ;
- seule la transition la plus récente est annulable, et seulement si l'année qu'elle a ouverte est
  encore l'année active. La ligne est verrouillée (`FOR UPDATE`) le temps du rejeu, donc deux
  animateurs qui cliquent en même temps ne peuvent pas la rejouer deux fois ;
- l'année ouverte n'est pas supprimée — `scout_year_transitions.to_scout_year_id` la référence, et
  la garder est ce qui permet à l'historique de dire qu'une transition a eu lieu puis été annulée.
  Elle repasse en `planning` et rend les jours qu'elle avait empruntés à l'année précédente (une
  transition lancée en avance avait ramené sa date de début au jour du clic). L'ordre compte :
  l'année ouverte est rétrécie **avant** que la précédente ne retrouve sa date de fin, sinon la
  contrainte d'exclusion `scout_years_no_overlap` se déclenche ;
- `openNextScoutYear` enregistre désormais dans le `changeset` l'état d'avant (`restore`) : la date
  de fin d'origine de l'année fermée, et la ligne que l'upsert a écrasée le cas échéant. Sans ça
  l'annulation ne saurait pas distinguer une année qu'elle a créée d'une année qui préexistait.

**Interface** — `spa/modules/scout-year/ScoutYearTransition.js` : section « Dernière transition »
sous le rapport et sur la page, avec le bouton « Annuler cette transition » quand c'est encore
possible, la liste nominative des obstacles quand ça ne l'est plus, et la date d'annulation quand
c'est déjà fait. Un refus du serveur recharge la raison plutôt que de laisser un bouton périmé.

**Consultation des années passées** — l'année consultée se choisit à un seul endroit et se propage
partout :

- `spa/modules/scout-year/ScoutYearContext.js` retient l'année choisie. Choisir l'année **active**
  efface la sélection au lieu de la stocker : l'absence de choix *est* « la saison en cours », donc
  le chemin par défaut n'envoie aucun en-tête et réutilise les entrées de cache existantes. Une
  sélection faite dans une autre unité est ignorée ;
- `spa/modules/scout-year/ScoutYearBanner.js` : sélecteur placé **hors de `#app`** pour survivre à
  la navigation, invisible pour une unité qui n'a qu'une seule année, et bandeau d'avertissement
  quand on consulte une archive ;
- `getAuthHeader()` ajoute `x-scout-year-id`, `buildScopedCacheKey()` suffixe la clé de cache, et
  `makeApiRequest()` **refuse toute écriture** en mode archive. La garde est dans la couche API et
  pas seulement dans l'interface : un seul bouton oublié écrirait sinon les données de l'an dernier
  dans la saison en cours, sans bruit, puisque le serveur estampille les écritures avec l'année
  active quelle que soit l'année affichée ;
- côté serveur, `withScoutYear(pool)` (`middleware/auth.js`) résout l'année une fois et pose
  `req.scoutYear` et `req.rosterStatuses`. Une année inconnue ou appartenant à une autre unité est
  un 400, pas un silence.

**Ce que « l'effectif d'une année » veut dire** — et c'est le point qui n'était pas évident : sur
l'année en cours, c'est qui est inscrit **maintenant**, donc un jeune parti en novembre n'y est
plus ; sur une année close, c'est **tout le monde** qui en a fait partie, y compris ceux qui sont
sortis à la fin. Sans cette distinction, chercher un ancien jeune dans son année ne le trouvait
pas — l'inscription y porte `status = 'graduated'`. C'est `req.rosterStatuses` qui porte la
différence.

**Endpoints rendus conscients de l'année** : `participants` (liste et décompte, effectif et points),
`attendance` (`/`, `/dates`, `/attendance`, `/attendance-dates` — bornés par la plage de dates de
l'année), `honors` (`GET /v1/honors`), les 15 rapports de `routes/reports.js`, et le tableau de bord
parent (`/api/dashboard/parent`, qui renvoie aussi `scout_year`). Les totaux de points et les
décomptes d'honneurs de ces endpoints sont désormais bornés par l'année consultée.

**Correctif de fuseau horaire** — les comparaisons de `created_at` du rollback castent explicitement
en `::timestamptz`. Une `Date` JS liée contre une colonne `timestamp without time zone` perd son
décalage : avec un serveur applicatif en UTC-4 et une base en UTC, les vérifications d'« année
vide » se trompaient de quatre heures et bloquaient l'annulation à tort. La suite d'intégration
tourne dans cette configuration précise, ce qui est comment le bug est apparu.

**Vérification** — `npm run test:scout-year` : 24 tests contre un vrai PostgreSQL. Transition
complète, annulation exacte, double annulation refusée, chaque famille d'obstacle, transition
rejouée après annulation, consultation d'une année close pour l'effectif / les présences / les
honneurs / un rapport, année étrangère refusée, tanières vides à la rentrée et lisibles dans
l'année passée, affectation écrite dans l'année en cours et pas dans celle consultée, et le
double comptage des frais (le test échoue bien avec l'ancienne vue : deux lignes au lieu d'une).
Pour l'effacement : les traces qui partent y compris celles qu'aucune cascade ne couvre, le parent
gardé parce qu'il a un autre enfant, le parent gardé parce qu'il est animateur, le refus sans le nom
exact, le refus pour un animateur, le refus pour un jeune d'une autre unité, et le journal d'audit
vérifié comme ne contenant aucun nom. Ignorés sans `SCOUT_YEAR_TEST_DATABASE_URL`.

Plus 20 tests jsdom sur l'assistant, le contexte d'année, la garde en lecture seule côté API et la
désactivation visuelle. Suite complète à 855 tests verts, 8 scripts de lint au vert.

**Tanières annuelles** — `migrations/add_scout_year_to_participant_groups.sql`, même motif que les
inscriptions : `participant_groups` devient `participant_group_assignments` avec un `scout_year_id`
et une PK à trois colonnes, et une vue de compatibilité du même nom, filtrée sur l'année active,
laisse les ~68 lectures existantes fonctionner. Les 10 écritures (toutes dans `participants.js`)
visent la table réelle et estampillent toujours l'année **en cours** : on n'écrit jamais une
affectation dans une archive.

Les affectations **ne sont pas reconduites** par la transition : la nouvelle année démarre sans
aucune, et l'équipe les refait à la rentrée. Les tanières elles-mêmes (`groups`) gardent leur nom et
leur identité. Aucun suivi des changements en cours d'année — ce qui compte est l'état à la fin de
l'année, et c'est exactement ce que donnent des lignes rattachées à l'année. Une affectation faite
dans la nouvelle année compte comme activité et bloque donc l'annulation de la transition
(`dens_assigned`).

**Lecture seule visible** — `spa/modules/scout-year/ArchiveReadOnly.js`. La couche API refusait déjà
toute écriture ; ce module rend l'état lisible plutôt que de présenter une page pleine de contrôles
qui échoueront tous au clic. Il observe `#app` (un `MutationObserver` débounçé) et désactive les
contrôles à chaque rendu, ce qui évite de toucher quarante modules. **Opt-out avec
`data-archive-safe`** pour tout ce qui sert à consulter — sélecteur de date, recherche, filtre de
tanière — parce que restreindre ce qu'on regarde est précisément l'intérêt d'ouvrir une archive. Un
contrôle que la page avait elle-même désactivé n'est jamais réactivé au retour.

**Droit à l'effacement** — `services/erasure.js`, `migrations/add_erasure_log.sql`,
`DELETE /api/v1/participants/:id/erasure`. Le seul endroit de l'application qui détruit vraiment des
données, et il le fait vraiment : masquer les lignes ne serait pas un effacement.

- **Ce qui part** : le jeune et tout ce qui cascade (inscriptions, affectations, points, présences,
  honneurs, formulaires, médication, OAS), plus ce qu'aucune clé étrangère ne rattraperait — les
  frais et paiements (`participant_fees` refuse de cascader), et `badge_progress` / `names` qui
  portent un `participant_id` sans contrainte derrière.
- **Les tuteurs** sans autre enfant, et **les comptes parents** sans autre enfant *et* sans rôle
  au-delà de parent. Un parent qui est aussi animateur garde son compte : le supprimer arracherait
  les traces de l'unité, qui ne sont pas les siennes à effacer. Les comptes conservés sont
  **remontés** avec leur raison, pas silencieusement ignorés. La suppression d'un compte se fait
  dans un `SAVEPOINT` : si une référence imprévue la bloque, le compte est conservé et signalé
  plutôt que de faire échouer tout l'effacement.
- **Ce qui reste** : les lignes qui pointent avec `ON DELETE SET NULL` survivent, anonymisées — une
  entrée de campagne de financement garde son montant, un rapport d'incident garde son récit. C'est
  le bon résultat pour la comptabilité et pour une trace de sécurité, mais le nom peut subsister
  dans le texte libre du rapport : le compte est **remonté à l'administrateur** pour traitement
  manuel plutôt que passé sous silence.
- **Garde-fous** : permission `participants.erase`, accordée à `unitadmin` et `district` seulement,
  jamais à `animation` ; re-vérifiée contre la base par la route, pas seulement dans le jeton ; et
  le nom complet du jeune doit être saisi, vérifié côté serveur.
- **Trace** : `erasure_log` enregistre qui, quand et combien de lignes — **jamais un nom, un
  courriel ou un identifiant de participant**. De quoi démontrer que la demande a été honorée sans
  reconstituer la personne qu'on a effacée.

**Correctif de revenus budgétaires** — `migrations/fix_budget_revenue_duplicate_fees.sql`.
Régression introduite par `create_scout_years_and_enrollments.sql` : `v_budget_revenue` joignait
`participant_organizations` sur le seul `participant_id`, ce qui était sans conséquence quand
c'était une table à une ligne par jeune. Le renommage en `participant_enrollments` a re-pointé la
vue **automatiquement** — une vue stocke l'OID de la table, pas son nom, donc rien n'a échoué et
rien n'a averti — et la jointure a commencé à ramener une ligne *par année scoute*. Conséquences,
toutes deux en production : un paiement compté une fois par saison d'inscription, donc des revenus
qui gonflent à chaque transition ; et la ligne prenant l'`organization_id` de l'inscription plutôt
que celui des frais, donc un jeune transféré pouvait faire apparaître des frais dans le budget
d'une autre unité. La jointure est supprimée : `participant_fees` porte son propre
`organization_id`, qui est le propriétaire légitime de l'argent.

### Pas fait

- **Modules non bornés par l'année** : finance, covoiturages, badges, formulaires, ressources et
  activités répondent toujours pour l'année active. Confirmé comme acceptable. Ils utilisent la vue
  de compatibilité et peuvent être convertis un par un, sans risque, sur le même modèle.
- **Frais et cotisations** (§6) : `participant_fees` et `payment_plans` ne sont pas rattachés à
  l'année ; les soldes impayés de l'an dernier restent tels quels. Confirmé comme voulu.
- **Purge / conservation (Loi 25)** : aucune politique de rétention automatique. L'effacement est
  désormais possible **sur demande** ; ce qui manque est la purge *non demandée* après N ans.
- **Statut alumni** : conception validée (§8.8), rien d'implémenté.
- **Transfert vers une unité sœur** : décidé (§8.5), rien d'implémenté.
- **Texte libre des rapports d'incident** : non expurgé par l'effacement, par choix. Le nombre de
  rapports concernés est remonté à l'administrateur.

### Trouvé au passage, hors périmètre

`organizations.(id, program_section)` et `organization_program_sections.organization_id` se
référencent mutuellement, et **aucune des deux contraintes n'est `DEFERRABLE`**. Aucune des deux
lignes ne peut donc être insérée en premier : créer une organisation depuis
`routes/organizations.js:499` échoue. La suite d'intégration contourne le problème en suspendant les
triggers de clé étrangère (`session_replication_role`), ce qui n'est acceptable que sur une base
jetable. Le correctif serait de rendre `organizations_program_section_fk` `DEFERRABLE INITIALLY
DEFERRED` et d'insérer les deux lignes dans une même transaction.

---

## 10. Renouvellement des formulaires — approche retenue

**Décision :** on ne repart pas d'une fiche vide. Le contenu saisi l'an dernier reste en place ; la transition y appose un drapeau **« à réviser »** pour que les parents la relisent et la corrigent au besoin. Cela vaut pour **tous les formulaires**, pas seulement la fiche santé.

C'est le bon compromis : une allergie ou un contact d'urgence ne change généralement pas d'une année à l'autre, et re-saisir douze champs identiques est le meilleur moyen d'obtenir des fiches abandonnées à moitié remplies. Mais une fiche non relue depuis deux ans ne doit pas passer pour à jour.

### Ce que ça implique

**Base de données**

```sql
ALTER TABLE form_submissions
  ADD COLUMN scout_year_id integer REFERENCES scout_years(id),
  ADD COLUMN review_state text NOT NULL DEFAULT 'current'
      CHECK (review_state IN ('current', 'needs_review')),
  ADD COLUMN flagged_for_review_at timestamptz,
  ADD COLUMN last_reviewed_at timestamptz,
  ADD COLUMN last_reviewed_by uuid REFERENCES users(id);
```

`review_state` porte l'état, `last_reviewed_at` porte la preuve. Confirmer sans rien changer est une action valide et doit être enregistrée comme telle : c'est l'information dont l'animateur a besoin (« cette fiche a bien été relue le 4 septembre »), et elle est distincte de `updated_at`.

**Transition** — l'exécution passe à `needs_review` toutes les soumissions actives des jeunes reconduits, et l'inscrit dans le `changeset` pour rester annulable.

**Côté parent** — un bandeau sur le tableau de bord listant les fiches à réviser, et sur chaque formulaire deux boutons : « Confirmer sans changement » et « Mettre à jour ». Les deux effacent le drapeau et écrivent `last_reviewed_at`.

**Côté animateur** — une colonne d'état sur la liste des participants, un filtre « fiches à réviser », et une relance groupée par courriel réutilisant les annonces existantes.

### Points à trancher avant d'implémenter

1. **Portée** — tous les formulaires publiés, ou seulement ceux marqués `is_required` ? Un formulaire ponctuel (sortie de l'an dernier) n'a pas de sens à réviser. Je proposerais : drapeau sur les formulaires `is_required`, plus ceux dont le `category` est santé/autorisation.
2. **Blocage ou simple signal ?** Est-ce qu'une fiche santé non révisée empêche l'inscription à une activité, ou est-ce seulement visible ? Le blocage est plus sûr et plus friction ; commencer par le signal seul me paraît raisonnable.
3. **Autorisations médicales** — elles portent une signature et une date. Une simple révision suffit-elle, ou faut-elle une nouvelle signature explicite ? Juridiquement, c'est probablement le seul cas où re-signer s'impose.
4. **Rappels** — au bout de combien de temps sans révision relance-t-on, et combien de fois ?

### État d'implémentation du §10

**Fait** — `migrations/add_form_review_flag.sql` et le raccordement complet :

- `form_submissions` reçoit `scout_year_id`, `review_state`, `flagged_for_review_at`, `last_reviewed_at`, `last_reviewed_by`, plus un trigger qui estampille l'année sur toute nouvelle soumission ;
- la transition passe à `needs_review` les formulaires **`is_required`** des jeunes reconduits, et note les identifiants touchés dans le `changeset` pour une annulation future ; le résumé remonte `forms_flagged_for_review` ;
- `GET /api/v1/forms/submissions/needs-review` — un parent ne voit que ses enfants, l'équipe voit l'unité ;
- `POST /api/v1/forms/submissions/:id/confirm-review` — confirmer sans rien changer, ce qui efface le drapeau et écrit `last_reviewed_at` **sans toucher `updated_at`** : c'est précisément ce qui distingue « relue » de « modifiée » ;
- modifier une fiche efface aussi le drapeau et enregistre la révision ;
- bannière sur le tableau de bord parent avec les deux boutons « Confirmer sans changement » et « Mettre à jour ».

Décisions appliquées : portée limitée aux formulaires requis, simple signal sans blocage.

**Vérifié** contre un PostgreSQL réel : le contenu est conservé, seule la fiche requise du jeune reconduit est marquée, la sortie facultative ne l'est pas, la fiche du jeune parti n'est pas touchée, un parent non lié ne voit ni ne peut confirmer la fiche d'un autre enfant, et `updated_at` ne bouge pas lors d'une confirmation.

**Autorisations médicales — re-signature explicite.** C'est la seule exception au principe « on conserve et on demande une relecture ». Une autorisation porte une signature et une responsabilité légale : la transition la passe à `expired`, et seule une nouvelle signature la rétablit. Il n'y a délibérément **pas** de bouton « confirmer sans changement » pour celles-là.

Les deux tables d'autorisation sont en ajout seul : signer insère une ligne, l'application lit la plus récente. Expirer ne modifie donc que le statut ; la signature de l'an dernier reste au dossier comme trace de ce qui avait été autorisé, et la nouvelle s'ajoute à côté. La lecture continue de renvoyer les réponses précédentes — le parent les voit pré-remplies — mais avec `requires_new_signature`, et `GET /v1/medication/authorizations/pending-signature` alimente une bannière distincte sur le tableau de bord parent.

**Rappels** : aucune relance automatique pour l'instant, par décision. Les fiches à réviser et les autorisations à signer sont visibles sur le tableau de bord, sans courriel de relance.

---

## 11. Ordre de déploiement — à respecter

**La migration `create_scout_years_and_enrollments.sql` doit être appliquée en même temps que le déploiement du code, pas avant.**

Elle transforme `participant_organizations` en vue. Le code de la version précédente y écrit à cinq endroits. Des triggers `INSTEAD OF` en couvrent trois (INSERT simple, `ON CONFLICT DO NOTHING` sans cible, DELETE), mais **pas** les deux qui utilisent une cible de conflit explicite :

```sql
INSERT INTO participant_organizations (...)
ON CONFLICT (participant_id, organization_id) DO NOTHING
```

PostgreSQL ne sait pas faire correspondre une cible de conflit à une vue et refuse la requête. Les deux endpoints concernés dans l'ancienne version sont l'enregistrement d'un participant et la liaison à une organisation (`routes/participants.js`).

Conséquence : entre l'application de la migration et le déploiement de cette branche, créer ou lier un participant échoue. Les lectures, les points, les présences et les formulaires continuent de fonctionner normalement.

Ordre recommandé : fusionner la branche → déployer → appliquer `create_scout_years_and_enrollments.sql` → `add_form_review_flag.sql` → `add_medication_authorization_resignature.sql` (les deux dernières dépendent de la première) → régénérer le dump de schéma.

### Application en production — 2026-08-01

Fait, dans cet ordre, après le déploiement du code. Répétée d'abord sur une restauration de la sauvegarde de production (PostgreSQL 18.4, mêmes données) : 224 ms au total, aucune erreur. En production : 5,3 s + 5,8 s + 2,2 s, latence réseau comprise.

Résultat, tous les compteurs préservés :

| | avant | après |
|---|---|---|
| inscriptions | 83 | 83, dont 0 non rattachée |
| effectif via la vue | 83 | 83 |
| points | 1881 | 1881, dont 0 non estampillé |
| soumissions de formulaires | 230 | 230, dont 0 non estampillée |
| adhésions | 121 | 121, toutes actives |

Historique reconstitué depuis la plus ancienne trace d'activité de chaque unité : trois années pour 6A St-Paul Aylmer (depuis 2023-2024), deux pour Demo Organization, une pour les trois autres. Aucune fiche marquée à réviser et aucune autorisation expirée — normal, aucune transition n'a encore été lancée.

Vérifié après coup sur la production : les deux chemins d'écriture (direct et via la vue) fonctionnent, les jointures de l'application renvoient le bon nombre de lignes, et les nouvelles routes répondent 401 plutôt que 404. Le dump de schéma a été régénéré.
