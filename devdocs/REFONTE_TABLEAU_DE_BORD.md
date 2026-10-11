# Tableau de bord — nommage et regroupement des tuiles

Les règles qui gouvernent le tableau de bord web. Le *quoi* est dans le code :
`spa/config/dashboard-tiles.js` (tuiles, groupes, ordre), `spa/config/dashboard-customization.js`
(domaines, palettes), `spa/config/tabbed-pages.js` (pages à onglets). Ce document en garde le
*pourquoi*. L'historique de la refonte (2026-07 et 2026-10) est dans git.

## 1. Une seule source

Chaque tuile est déclarée **une fois**, dans `spa/config/dashboard-tiles.js`, avec son `moment`, son
`domain`, sa `priority` et une règle de visibilité déclarative (`gate`) que `spa/dashboard.js`
résout. Rien d'autre ne redéclare de tuile. Une destination de tableau de bord est une page, pas un
onglet (`?tab=`) : les onglets se trouvent dans la page.

## 2. Nommer la tâche, pas l'écran

1. **Verbe à l'infinitif + complément** quand la tuile mène à une action : *Faire les présences*,
   *Contacter les parents*, *Réserver du matériel*.
2. **Un seul mot porteur par tuile.** Deux tuiles d'un même groupe ne commencent pas par le même mot.
   Pas de « Gérer… » ni « Gestion de… » en tête : c'est le mot le moins informatif.
3. **Le libellé de la tuile est le `<h1>` de la page d'arrivée.** Sans exception.
4. **Le jargon scout n'est pas le libellé principal** (« tanière », « loup d'honneur », « meute »),
   sauf s'il est *le* mot de la tâche. Les termes d'unité passent par le vocabulaire de l'unité
   (`devdocs/UNIT_CUSTOMIZATION.md`).
5. **28 caractères au plus**, pour tenir sur deux lignes en tuile mobile.
6. **Le français d'abord** ; l'anglais en est traduit. En français : apostrophe typographique `’`,
   pas de majuscule aux noms communs.

## 3. Les clés `tile_*`

Les libellés de tuiles ont leur propre espace de noms, `tile_*`. Les clés génériques (`attendance`,
`reports`, `fundraisers`…) servent aussi aux en-têtes, colonnes et filtres : y mettre un verbe le
ferait fuiter partout. `tile_*_aliases` porte des synonymes de recherche, séparés par des virgules,
pour la palette de commandes (qui ignore aussi les accents). Ne déclarer `aliases` que si la clé existe
dans les deux fichiers de langue, sinon `translate()` renvoie la clé brute dans la recherche.

## 4. Organisation

- **Trois moments** : *En ce moment* (actions liées à une réunion en cours ; l'action principale est
  « Faire les présences », car on note qui est là avant de récompenser), *Cette semaine* (ce qui se
  prépare avant la prochaine sortie), *Tout le reste* (groupes repliables).
- **Groupes de « Tout le reste »**, dans l'ordre de `TOOL_GROUP_ORDER` :
  - *Jeunes et familles* (`people`) : ce qu'on fait chaque semaine ;
  - *Santé et sécurité* (`safety`) ;
  - *Matériel et logistique* (`logistics`) : « Réserver du matériel » est à côté de « Inventaire du
    matériel », la paire la plus confondue ;
  - *Argent* (`money`) ;
  - *Administration de l'unité* (`admin`) : ce qu'on configure quelques fois par année ;
  - *Administration* (`system`) : le compte personnel et les outils district ou système.
- **Pas de groupe à une seule tuile** : un accordéon autour d'un seul élément est pire que rien.
- `logistics`, `money` et `admin` sont repliés au premier affichage, sauf le groupe qui correspond au
  rôle de la personne. Dès qu'elle replie ou déplie quelque chose, son choix l'emporte définitivement.
- Les domaines `communications` et `neutral` restent déclarés dans `DOMAINS` sans tuile :
  `applyPalette()` écrit une variable CSS par domaine et une tuile de domaine inconnu retombe sur
  `neutral`.
- **Visibilité** : une tuile suit la permission dont sa page a besoin, comme le serveur. Une
  permission d'accès au panneau admin ne suffit pas à elle seule (« Paramètres de l'unité » exige une
  permission de `UNIT_SETTINGS_TILE_PERMISSIONS`, « Accès aux formulaires » exige `forms.manage`).

## 5. Pages fusionnées

Deux écrans qui se confondaient deviennent les onglets d'une même page, plutôt qu'une réécriture :

- **Coquille** — `spa/modules/TabbedPage.js` : possède `#app`, dessine l'en-tête et les onglets,
  synchronise `?tab=` avec l'URL, charge l'onglet actif en différé et détruit le précédent. Un onglet
  qui échoue n'emporte pas la page. Navigation ←/→ selon le motif ARIA *tabs*.
- **Contrat de montage** — `spa/utils/PageMount.js` : une page hébergeable accepte
  `options.containerId` et `options.embedded`, rend dans `getMountPoint(this)`, et omet son lien
  retour et son `<h1>` quand elle est hébergée.
- **Déclaration** — `spa/config/tabbed-pages.js`. Les anciennes routes restent valides :
  `MERGED_ROUTE_REDIRECTS` les renvoie vers le bon onglet (signets, liens internes, URL en cache du
  service worker).

N'imbriquez pas d'onglets dans des onglets. `/budgets` et `/revenue-dashboard`, qui ont déjà les
leurs, restent deux tuiles distinctes pour cette raison.

## 6. Pour le portage mobile

Le tableau de bord mobile (`mobile/src/screens/LeaderDashboardScreen.js`) n'a pas suivi : il a ses
propres sections et ses propres fichiers de langue (`mobile/assets/lang/`), en retard sur `lang/`. Le
portage se fera d'un bloc, une fois le SPA stable. Ce que le web fournit déjà, sous forme
déclarative et sans dépendance au DOM :

- `spa/config/dashboard-tiles.js` : tuiles, libellés, groupes, règles de visibilité ;
- `spa/config/tabbed-pages.js` : composition des pages fusionnées ;
- les clés `tile_*` et `tile_*_aliases`.

Seul le rendu est propre au mobile : `TabbedPage` et `PageMount` sont des mécanismes DOM, à refaire
avec les onglets de React Navigation. Décider d'abord si web et mobile partagent un même fichier de
langue plutôt que deux copies.
