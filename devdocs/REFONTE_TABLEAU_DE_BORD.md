# Refonte du tableau de bord — nommage et regroupement

**Date :** 2026-07-31
**Portée :** `spa/dashboard.js`, `spa/config/dashboard-customization.js`, `spa/config/dashboard-tiles.js`, `spa/modules/CommandPalette.js`, `spa/utils/DashboardPreferences.js`, `lang/fr.json`, `lang/en.json`
**Objectif :** rendre les tuiles trouvables du premier coup, en nommant **la tâche** plutôt que **l'écran**. Priorité au français.

> **État : lots 1 à 3 livrés** (voir §7 pour ce qui a été fait, ce qui a été
> ajusté en cours de route, et ce qui reste). Le lot 4 — fusion de *pages* —
> n'est pas fait. Le tableau de bord **mobile** (`mobile/src/screens/LeaderDashboardScreen.js`)
> n'est pas touché : voir §9.

---

## 1. Diagnostic

### 1.1 Trois taxonomies se superposent

| Où | Découpage | Statut |
|---|---|---|
| `spa/config/dashboard-tiles.js` | 6 sections (Quotidien, Planification, Gestion de l'unité, District, Finances, Communications) | **Fichier mort — jamais importé** |
| `spa/dashboard.js:351-440` | Les 6 mêmes sections, redéclarées en dur, mais avec un contenu différent | Utilisé seulement pour remplir `allTiles` |
| `spa/config/dashboard-customization.js` (`TILE_CONTEXT`) | 3 « moments » (En ce moment / Cette semaine / Outils) puis 8 sous-domaines | C'est ce que l'utilisateur voit |

Les six sections sont donc construites, puis **jetées** : `dashboard.js:476-500` remet toutes les tuiles à plat et les re-répartit par `moment`. Le travail de regroupement fait dans `dashboard-tiles.js` n'atteint jamais l'écran.

### 1.2 « Outils » est un fourre-tout

Sur les 42 tuiles de `TILE_CONTEXT` : **4** en « En ce moment », **7** en « Cette semaine », **31** en « Outils ». Autrement dit ~75 % du tableau de bord est dans une section dont le nom ne veut rien dire, découpée en jusqu'à 8 accordéons dont plusieurs ne contiennent qu'une ou deux tuiles.

### 1.3 Libellés en double ou quasi-identiques

| # | Tuile A | Tuile B | Problème |
|---|---|---|---|
| 1 | `administration` → **« Gestion de district »** (`/admin`) | `district_management_title` → **« Gestion de district »** (`/district-management`) | **Chaîne FR identique**, deux destinations différentes (`dashboard.js:395` et `:398`) |
| 2 | `manage_names` → « Liste des participants » | `feuille_participants` → « Feuille des participants » | Deux « … des participants » côte à côte |
| 3 | `inventory_link` → « Inventaire » | `material_management_link` → « Gestion du matériel » | Même sujet, aucun indice sur la différence |
| 4 | `medication_dispensing_link` / `medication_planning_link` / `med_reception_link` | « Distribution / Planification / Réception des médicaments » | Trois tuiles qui commencent par le même mot |
| 5 | `finance_memberships_tab` / `finance_definitions_tab` / `financial_report` / `revenue_dashboard` | 4 tuiles, dont **3 pointent sur la même page** `/finance` avec un `?tab=` | Bruit pur |
| 6 | `upcoming_meeting` « Prochaine réunion » | `preparation_reunions` « Préparation des réunions » | Distinction non évidente |
| 7 | `badge_tracker_title` « Badges de la Meute » | `program_progress_nav` « Progression du programme » | Chevauchement conceptuel |
| 8 | `activities_calendar` « Calendrier d'activités » | `yearly_planner_nav` « Plan annuel » | Deux planifications |
| 9 | `manage_groups` « Gérer les Groupes » | `manage_points` « Gérer les Points » | Le mot porteur est « Gérer », pas le sujet |

### 1.4 Le libellé ne correspond pas à la page d'arrivée

| Tuile | Libellé FR | `<h1>` de la page | Fichier |
|---|---|---|---|
| `/manage-participants` | « Liste des participants » | **« Assigner les groupes et les rôles »** | `spa/manage_participants.js:118` |
| `/group-participant-report` | « Feuille des participants » | **« Liste des tannières »** | `spa/group-participant-report.js:62` |
| `/admin` | « Gestion de district » | **« Espace district »** | `spa/admin.js:165` |
| `/inventory` | « Inventaire » | « Inventaire du matériel » | `spa/inventory.js:200` |

L'utilisateur clique, atterrit sur autre chose que ce qu'il a lu, revient en arrière. C'est le principal générateur de « je ne trouve rien ».

### 1.5 Les libellés nomment un objet, pas une action

« Présence », « Rapports », « Inventaire », « Dépenses », « Budget », « Contacts d'urgence » — ce sont des noms de tables, pas des tâches. L'utilisateur, lui, arrive avec une intention : *« il faut que j'appelle la mère de Léo »*, *« il faut que je fasse signer l'autorisation »*, *« il faut que je note qui est là »*.

### 1.6 Problèmes de rédaction française

- `dashboard_summary_title` = **« Vue d'overview »** — franglais, à corriger.
- Apostrophes incohérentes dans `lang/fr.json` : **338** valeurs avec `'` droite, **122** avec `’` typographique. Sur une même grille de tuiles on lit « Contacts d’urgence » à côté de « Calendrier d'activités ».
- Majuscules incohérentes : « Gérer les Points », « Gérer les Groupes », « Badges de la Meute » vs. le reste en minuscules. Le français ne capitalise pas les noms communs.

---

## 2. Principes de nommage proposés

1. **Verbe à l'infinitif + complément** quand la tuile mène à une action : *Faire les présences*, *Contacter les parents*, *Réserver du matériel*.
2. **Un seul mot porteur par tuile.** Aucune tuile ne doit commencer par le même mot qu'une autre dans le même groupe. Bannir « Gérer… » et « Gestion de… » comme préfixe — c'est le mot le moins informatif de la liste.
3. **Le libellé de la tuile = le `<h1>` de la page d'arrivée.** Sans exception.
4. **Le jargon scout n'est jamais le libellé principal.** « tanière », « loup d'honneur », « meute » restent dans la page, pas sur la tuile — sauf si le mot est *le* mot de la tâche.
5. **≤ 28 caractères** pour tenir sur deux lignes en tuile mobile.
6. **Le français d'abord.** L'anglais est traduit du français, pas l'inverse — les libellés actuels trahissent souvent la traduction mécanique dans l'autre sens.

---

## 3. Nouvelle architecture proposée

On garde les 3 moments (le concept est bon) mais on assèche le fourre-tout.

```
┌─ EN CE MOMENT ────────────────────────────  (héros + 3 raccourcis)
│  Actions liées à une réunion en cours / aujourd'hui
│
├─ CETTE SEMAINE ──────────────────────────  (grille)
│  Ce qui doit être préparé avant la prochaine sortie
│
└─ TOUT LE RESTE ──────────────────────────  (6 groupes repliables)
   1. Jeunes et familles          2. Progression
   3. Santé et sécurité           4. Matériel et logistique
   5. Argent                      6. Administration
```

**Changements par rapport à l'existant :**

- « Outils » → **« Tout le reste »** (EN : *Everything else*). Un titre honnête vaut mieux qu'un titre creux. Alternative : supprimer le titre de section et ne garder que les 6 groupes.
- Les 8 sous-domaines actuels (`people`, `attendance`, `progression`, `logistics`, `safety`, `communications`, `money`, `admin`, `neutral`) passent à **6 groupes**, chacun avec au moins 2 tuiles :
  - `communications` fusionne dans **Jeunes et familles** (écrire aux familles, c'est parler aux familles).
  - `neutral` disparaît — chaque tuile reçoit un domaine explicite.
  - `attendance` n'a plus de tuile en « Outils » (toutes ses tuiles sont dans « En ce moment »).
- Les trois premiers groupes ouverts par défaut, les autres repliés (`collapsedToolGroups` dans `DashboardPreferences`), sauf le groupe correspondant au rôle de l'utilisateur.
- **Les tuiles district ne forment plus un groupe** : elles rejoignent « Administration de l'unité » en fin de liste (`priority` 30-32). Elles restent accessibles — voir l'ajustement n° 2 en §7.

---

## 4. Table de renommage complète

Légende : **⚠️** = corrige une collision de libellés · **↔** = corrige un écart libellé/page · **⊕** = fusion recommandée

### 4.1 En ce moment

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/attendance` | Présence | **Faire les présences** | Take attendance | |
| `/managePoints` | Gérer les Points | **Donner des points** | Give points | ⚠️ |
| `/manageHonors` | Loups d'honneurs | **Décerner les honneurs** | Award honours | jargon → sous-titre |
| `/upcoming-meeting` | Prochaine réunion | **Prochaine réunion** | Next meeting | inchangé |
| `/medication-dispensing` | Distribution des médicaments | **Donner les médicaments** | Give medication | ⚠️ (promue « maintenant » en camp) |

### 4.2 Cette semaine

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/preparation-reunions` | Préparation des réunions | **Préparer la réunion** | Prepare the meeting | ⚠️ vs. « Prochaine réunion » |
| `/permission-slips` | Autorisations parentales | **Faire signer les autorisations** | Collect permission slips | |
| `/carpool` | Coordination du covoiturage | **Organiser le covoiturage** | Organise carpooling | |
| `/activities` | Calendrier d'activités | **Planifier une activité** | Plan an activity | ⚠️ vs. Plan annuel |
| `/material-management` | Gestion du matériel | **Réserver du matériel** | Reserve equipment | ⚠️ vs. Inventaire |
| `/medication-planning` | Planification des médicaments | **Planifier les doses** | Schedule doses | ⚠️ |
| `/yearly-planner` | Plan annuel | **Planifier l'année** | Plan the year | ⚠️ |

### 4.3 Jeunes et familles

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/parent-contact-list` | Contacts d'urgence | **Contacter les parents** | Contact parents | exemple donné par le demandeur |
| `/manage-participants` | Liste des participants | **Assigner groupes et rôles** | Assign groups & roles | ↔ aligne sur le `<h1>` réel |
| `/manage-groups` | Gérer les Groupes | **Créer les groupes** | Create groups | ⚠️ |
| `/manage-users-participants` | Lier les jeunes aux parents | **Lier les jeunes aux parents** | Link youth to parents | déjà bon — modèle à suivre |
| `/view-participant-documents` | Voir les documents des participants | **Consulter les fiches santé** | View health forms | 34 → 24 caractères |
| `/group-participant-report` | Feuille des participants | **Imprimer la liste des tanières** | Print den lists | ↔ ⚠️ |
| `/parent-dashboard` | Vue des parents | **Voir l'app comme un parent** | Preview as a parent | lève l'ambiguïté « liste de parents ? » |
| `/communications` | Communications et clavardage | **Écrire aux familles** | Message families | |
| `/mailing-list` | Liste de diffusion | **Gérer les listes d'envoi** | Manage mailing lists | |

### 4.4 Progression

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/badge-tracker` | Badges de la Meute | **Suivre les badges** | Track badges | ⚠️ |
| `/program-progress` | Progression du programme | **Étapes du programme** | Program stages | ⚠️ ⊕ candidat à fusion avec le suivi des badges (deux onglets d'une même page « Progression ») |

### 4.5 Santé et sécurité

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/medication-reception` | Réception des médicaments | **Recevoir les médicaments** | Log medication received | ⚠️ |

*(Les autres tuiles santé — donner / planifier / autorisations — sont déjà remontées dans « En ce moment » et « Cette semaine ». Le groupe reste visible mais court, ce qui est voulu : en camp, c'est le groupe qu'on ouvre.)*

### 4.6 Matériel et logistique

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/inventory` | Inventaire | **Inventaire du matériel** | Equipment inventory | ↔ ⚠️ aligne sur le `<h1>` |

### 4.7 Argent — de 8 tuiles à 6

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/finance` | Paiements et adhésions | **Encaisser les paiements** | Record payments | |
| `/expenses` | Dépenses | **Saisir les dépenses** | Record expenses | |
| `/external-revenue` | Revenus externes | **Saisir dons et subventions** | Record donations & grants | |
| `/fundraisers` | Campagnes de financement | **Campagnes de financement** | Fundraising campaigns | inchangé |
| `/finance?tab=definitions` | Définition des frais | **— retirer du tableau de bord** | | ⊕ onglet dans « Encaisser les paiements » |
| `/finance?tab=reports` | Rapport financier | **— retirer** | | ⊕ fusionner avec le tableau de bord des revenus |
| `/revenue-dashboard` | Tableau de bord des revenus | **Bilan financier** | Financial overview | ⊕ absorbe `?tab=reports` |
| `/budgets` | Gestion du budget | **Préparer le budget** | Build the budget | conservée : la fusion en onglet reste à faire (lot 4) |

> Justification : trois tuiles pointaient sur `/finance` avec un simple `?tab=`. Une tuile de tableau de bord doit correspondre à une destination, pas à un onglet — et `spa/finance.js:293` affiche déjà ces onglets dans la page, donc rien n'est perdu.

### 4.8 Administration

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/unit-settings` | Paramètres de l'unité | **Paramètres de l'unité** | Unit settings | inchangé |
| `/reports` | Rapports | **Exporter des rapports** | Export reports | ↔ |
| `/role-management` | Gestion des rôles | **Rôles et permissions** | Roles & permissions | ⚠️ |
| `/form-permissions` | Permissions des formulaires | **Accès aux formulaires** | Form access | ⚠️ |
| `/account-info` | Paramètres du compte | **Mon compte** | My account | ⚠️ vs. Paramètres de l'unité |

### 4.9 District et système — relégué en fin du groupe Administration

| Route | FR actuel | **FR proposé** | EN proposé | Note |
|---|---|---|---|---|
| `/admin` | Gestion de district | **Espace district** | District panel | ⚠️ ↔ **collision exacte** avec la ligne suivante |
| `/district-management` | Gestion de district | **Unités du district** | District units | ⚠️ ⊕ candidat à fusion avec `/admin` |
| `/create-organization` | Créer l'unité | **Créer une nouvelle unité** | Create a new unit | |

### 4.10 Titres de sections et de groupes

| Clé | FR actuel | **FR proposé** | EN proposé |
|---|---|---|---|
| `dashboard_now_section` | En ce moment | **En ce moment** | Right now |
| `dashboard_this_week_section` | Cette semaine | **Cette semaine** | This week |
| `dashboard_tools_section` | Outils | **Tout le reste** | Everything else |
| `domain_people` | Personnes | **Jeunes et familles** | Youth & families |
| `domain_progression` | Progression | **Progression** | Progression |
| `domain_safety` | Santé et sécurité | **Santé et sécurité** | Health & safety |
| `domain_logistics` | Logistique | **Matériel et logistique** | Equipment & logistics |
| `domain_money` | Finances | **Argent** | Money |
| `domain_admin` | Administration | **Administration de l'unité** | Unit administration |
| `domain_communications` | Communications | *(fusionné dans `people`)* | |
| `domain_neutral` | Autre | *(supprimé)* | |
| `dashboard_summary_title` | **Vue d'overview** ⚠️ franglais | **Vue d'ensemble** | Status overview |

---

## 5. Point technique important : ne pas renommer les clés partagées

Plusieurs libellés de tuiles réutilisent des clés i18n génériques employées ailleurs dans l'app :

| Clé | Nombre d'usages hors tableau de bord |
|---|---|
| `attendance` | 16 |
| `reports` | 12 |
| `fundraisers` | 10 |

Changer `attendance` en « Faire les présences » ferait fuiter le verbe dans les en-têtes de tableaux, les filtres et les rapports.

**Recommandation :** créer un espace de noms dédié `tile_*` pour les libellés de tuiles.

```js
// spa/config/dashboard-customization.js — ou la source unique de tuiles
{ href: "/attendance", icon: "fa-clipboard-check", label: "tile_attendance" }
```

```json
// lang/fr.json
"tile_attendance": "Faire les présences",
"attendance": "Présence"
```

Le tableau de bord parle en tâches ; les pages, les colonnes et la navigation gardent leur nom d'objet. C'est aussi ce qui permet d'ajouter des **synonymes de recherche** pour la palette de commandes (`CommandPalette` ne filtre aujourd'hui que sur le libellé traduit) :

```json
"tile_attendance_aliases": "présences, absents, qui est là, pointage",
"tile_parent_contact_list_aliases": "téléphone, appeler, urgence, numéro, parents"
```

---

## 6. Anomalies trouvées en chemin

1. **`spa/config/dashboard-tiles.js` est du code mort** — aucun import dans `spa/`, `test/` ni `mobile/`. Il a divergé de `dashboard.js` : il lui manque `/medication-reception`, `/unit-settings` et `/account-info`, et ses garde-fous de permissions ne correspondent plus. À supprimer, ou à promouvoir en source unique (mon choix — voir §7).

2. **Clé de traduction manquante :** `dashboard.js:431` utilise `label: "parent_dashboard"`, absent de `lang/fr.json` et `lang/en.json`. `translate()` retombe sur la clé brute (`spa/app.js:690`), donc la tuile affiche littéralement `parent_dashboard`. Visible en mode `finance-focused`. La clé existante est `vue_parents`.

3. **Collision exacte de libellés :** `dashboard.js:395` et `:398` produisent deux tuiles « Gestion de district » côte à côte (voir §4.9).

4. **Les tuiles sont déclarées deux fois** — dans `dashboard-tiles.js` (mort) et en dur dans `dashboard.js:351-440`. Toute correction doit aujourd'hui être faite à deux endroits, ce qui explique la dérive.

5. **Apostrophes mixtes** dans `lang/fr.json` (338 `'` / 122 `’`). Normaliser sur `’` — c'est l'apostrophe correcte en typographie française.

---

## 7. État de la mise en œuvre

### Lot 1 — Anomalies ✅ fait

- `spa/config/dashboard-tiles.js` est devenu la **source unique** : toutes les
  tuiles y sont déclarées une fois, avec leur `moment`, `domain`, `priority`,
  et une règle de visibilité déclarative (`gate`) résolue par `dashboard.js`.
  Les déclarations en dur de `dashboard.js` et `TILE_CONTEXT` sont supprimées —
  il n'y a plus de deuxième endroit où la dérive puisse reprendre.
- La tuile qui affichait littéralement `parent_dashboard` utilise désormais une
  clé qui existe.
- `dashboard_summary_title` : « Vue d'overview » → « Vue d'ensemble ».

### Lot 2 — Renommage ✅ fait

- 40 clés `tile_*` + 39 clés `tile_*_aliases` ajoutées dans `lang/fr.json` **et**
  `lang/en.json` (2867 clés de chaque côté, `lint:i18n-parity` passe).
- Les clés génériques partagées (`attendance`, `reports`, `fundraisers`…) ne sont
  pas touchées : les pages, colonnes et filtres gardent leur nom d'objet.
- 334 valeurs françaises normalisées sur l'apostrophe typographique `’`. La
  substitution ne vise que les élisions (lettre + `'` + lettre), donc les
  guillemets simples (`Appuyez sur 'Lier un appareil'`) et les identifiants
  techniques (`'inscription_participant'`) sont intacts.
- La palette de commandes cherche maintenant dans les synonymes **et** ignore
  les accents : « presence » trouve « Faire les présences ».

### Lot 3 — Regroupement ✅ fait

- 8 sous-groupes → **6**, dans un ordre explicite (`TOOL_GROUP_ORDER`) qui ne
  dépend plus de la tuile arrivée première au tri.
- `communications` fusionné dans `people` ; plus aucun groupe « Autre ».
- Groupes `logistics`, `money`, `admin` repliés au premier affichage —
  **sauf** celui qui correspond au rôle de l'utilisateur : un trésorier trouve
  « Argent » déjà ouvert. Dès que la personne replie ou déplie quoi que ce
  soit, son choix prime définitivement.

### Ajustements par rapport à la proposition initiale

Quatre points où j'ai dévié, et pourquoi :

1. **`/budgets` reste une tuile** (« Préparer le budget »). La proposition en
   faisait un onglet de « Bilan financier » — mais tant que ce travail de page
   n'est pas fait, retirer la tuile rendrait les budgets inaccessibles.
   Résultat : finances **8 → 6 tuiles**, pas 8 → 4.
2. **Les tuiles district restent sur le tableau de bord**, reléguées en fin du
   groupe « Administration de l'unité ». Les retirer aurait coupé le seul accès.
   Ma remarque « ça pollue le tableau de bord de tous les animateurs » était
   partiellement fausse : ces tuiles sont déjà filtrées par permission. Elle
   reste vraie pour `/admin` et `/form-permissions`, dont les garde-fous
   (`canAccessAdminPanel`) laissent passer le rôle `leader` — d'où la relégation.
3. **« Réserver du matériel » descend de « Cette semaine » vers « Matériel et
   logistique »**, pour être à côté de « Inventaire du matériel » : c'était la
   paire la plus confondue, les séparer aurait entretenu le problème. Effet de
   bord voulu : plus aucun groupe à une seule tuile.
4. **L'action principale devient « Faire les présences »** au lieu de « Donner
   des points » : on note qui est là avant de récompenser.

`communications` et `neutral` restent déclarés dans `DOMAINS` et dans les cinq
palettes : aucune tuile ne les utilise, mais `applyPalette()` écrit une variable
CSS par domaine et `_renderTile` retombe sur `neutral` pour tout domaine inconnu.
Les retirer aurait cassé ce filet de sécurité.

### Lot 4 — Fusion de pages ❌ non fait

Reste à décider et à implémenter :

- `/admin` (« Espace district ») et `/district-management` (« Unités du
  district ») — les libellés ne se marchent plus dessus, mais ce sont toujours
  deux pages pour un même sujet.
- « Suivre les badges » et « Étapes du programme » — candidats à une page
  « Progression » à deux onglets.
- « Prochaine réunion » et « Préparer la réunion ».
- `/budgets` et `/revenue-dashboard` — un « Bilan financier » à deux onglets.

**Bilan mesuré :** 39 tuiles déclarées, **39 libellés distincts** (aucun doublon),
aucune clé de traduction manquante. Un animateur aux permissions de base voit
24 tuiles dont 20 sans rien déplier ; un responsable d'unité en voit 38.
Avant : 42 tuiles, 2 libellés identiques, ~31 tuiles noyées dans « Outils ».

---

## 8. Vérifications passées

```
npm run lint:i18n-parity     ✅ 2867 clés de chaque côté
npm run lint:spa-files       ✅
npm run lint:sql-params      ✅
npm run lint:api-version     ✅
npm run lint:duplicate-mounts / non-versioned-mounts   ✅
npx vite build               ✅
npx jest                     ✅ 48 suites, 810 tests
```

`lint:spa-console` et `lint:spa-innerhtml` nécessitent `ripgrep`, absent de la
machine ; vérifiés manuellement sur les fichiers modifiés (aucun `console.` ni
`innerHTML =`).

---

## 9. Le tableau de bord mobile n'est pas aligné

`mobile/src/screens/LeaderDashboardScreen.js` est un second tableau de bord, avec
ses propres sections (`dayToDay`, `preparation`, `operations`) et **ses propres
fichiers de langue** : `mobile/assets/lang/{fr,en,id,it,uk}.json`, distincts de
`lang/`. Ces copies sont déjà **785 clés en retard** sur le web — une dérive
antérieure à cette refonte.

Conséquence : le mobile garde les anciens libellés (« Contacts d'urgence »,
« Liste des participants », « Gestion du matériel »). C'est délibéré :

- aligner le mobile suppose d'ajouter les ~79 clés dans **cinq** fichiers, dont
  l'indonésien, l'italien et l'ukrainien, que je ne peux pas traduire avec une
  qualité acceptable ;
- la vraie question en amont est de savoir si les deux plateformes doivent
  partager un fichier de langue plutôt que d'en maintenir deux copies.

À trancher avant d'attaquer le mobile.

---

## 10. Récapitulatif des ajouts i18n

Toute clé ajoutée doit exister dans `lang/en.json` **et** `lang/fr.json` (voir
`CLAUDE.md` §1 et `npm run lint:i18n-parity`). Ajouts effectifs : 40 clés
`tile_*` et 39 clés `tile_*_aliases`, plus 7 valeurs existantes corrigées.

Trois anciennes clés ne sont plus référencées nulle part dans `spa/` ni dans
`mobile/` : `med_reception_link`, `yearly_planner_nav`, `program_progress_nav`.
Elles sont laissées en place (le lint de parité ne se plaint pas des clés en
trop). En revanche `manage_names`, `feuille_participants`, `vue_parents`,
`inventory_link`, `material_management_link`, `medication_dispensing_link` et
`medication_planning_link` **doivent être conservées** : elles sont encore
utilisées par le tableau de bord mobile.
