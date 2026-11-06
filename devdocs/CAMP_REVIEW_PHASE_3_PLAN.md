# Bilan de camp — préparation de la tranche 3

Statut : plan de réalisation, aucun comportement applicatif modifié.
Préparé le 6 novembre 2026 pour #1257, sur la tranche 2 (#1403).
Base vérifiée : `f0c67d9b436ef9be7f4f439877242d6c4ac11439`.
Attendre la stabilisation de #1403 avant de publier une PR de réalisation.

## Objectif utilisateur

Retrouver les bilans clos de l'unité, puis tenir compte de ce qui a fonctionné ou posé
problème au moment de préparer un nouveau camp. La personne voit les observations,
leur poids et le camp d'origine, sans devoir changer d'année scoute.

Exemples d'acceptation :

- Une animatrice prépare le prochain camp d'hiver au même lieu : le plan lui montre
  « À reprendre » et « À corriger », avec l'action retenue et un lien vers le bilan source.
- Un animateur réutilise un ancien camp : avant de copier son horaire ou son matériel,
  il peut lire ce que l'équipe avait décidé d'améliorer.
- Une personne consulte une année archivée : les bilans restent accessibles en lecture;
  consulter cette archive ne propose aucune écriture.

## État du dépôt et décisions à conserver

| Élément | Source actuelle | Conséquence |
| --- | --- | --- |
| Identifiant d'un bilan | `camp_reviews.meeting_id`, camp de `year_plan_meetings` | Utiliser `meetingId`, sans réintroduire `activityId` comme clé primaire de parcours. |
| Permissions | `camp_reviews.view`, `camp_reviews.manage` | Réutiliser ces droits; aucune permission supplémentaire prévue. |
| Lieu | `camp_details.camp_site_id` et `camp_sites` | Comparer les identifiants dans la même unité; ne pas comparer les noms libres. |
| Profil de séjour | `camp_details.season`, `camp_details.accommodation` | Les filtres peuvent proposer « Saison » et « Hébergement », avec les choix partagés de `config/camp_sites.json`. |
| « Type de camp » | Aucun champ générique identifié | Ne pas inventer un `camp_type` ni présenter silencieusement la saison comme une classification existante. |
| Plan | `services/campPlan.js`, `CampPlan.js`; lien « Évalué » déjà présent | Ajouter les enseignements à proximité des sections de préparation; garder distinctes préparation de l'évaluation et clôture du bilan. |
| Duplication | `listDuplicationSources()`, `CampDuplication.js` | Ajouter une consultation du bilan source; le bilan et ses voix ne deviennent pas une nouvelle partie à copier. |
| Réponse à une écriture | `{ note, notes }` depuis #1403 | Conserver la liste confirmée et les protections contre les réponses anciennes lors de toute évolution. |

Proposition pour cette tranche : utiliser les notions déjà saisissables, sous leurs vrais
libellés : lieu, saison et hébergement. Le rapprochement « même profil » signifie
saison **et** hébergement identiques, tous deux renseignés. Cette règle est une proposition
de produit, pas un champ existant nommé « type ». Si un type distinct est souhaité, sa
définition, sa saisie et sa migration doivent être ajoutées explicitement avant ce filtre.

## Parcours et interface

### 1. Historique : /camp-reviews

- Entrée « Bilans de camp » depuis la liste des plans, accessible avec `camp_reviews.view`.
- Seulement les bilans clos, du camp le plus récent au plus ancien. Dates de camp, état et
  nom du lieu sont écrits; un lieu archivé conserve son nom et reste filtrable.
- Filtres natifs étiquetés : lieu, saison, hébergement. Effacer les filtres se fait en une action.
- Chaque résultat donne le nom du camp, ses dates, son lieu, la date de clôture,
  les nombres de notes « À reprendre » / « À corriger » et « Ouvrir le bilan ».
- États distincts : aucun bilan clos, aucun résultat pour ces filtres, chargement,
  erreur avec Réessayer. Pagination bornée; aucune liste tronquée sans l'annoncer.
- Ouvrir le détail existant `/camp-review/:id`; aucun écran de saisie parallèle.
- Tous les textes et les nombres sont localisés. Aucun nom de jeune n'est nécessaire.

### 2. Préparer le prochain camp

Dans `/camp-plan/:id` et `/camp-readiness/:id`, proposer un même composant
« Enseignements des camps précédents » plutôt qu'un titre affirmant « L'an dernier »
pour une observation vieille de plusieurs années.

- Deux groupes : « À reprendre » et « À corriger ». Montrer la note, son action, son poids,
  la date et le nom du camp d'origine.
- Préciser pourquoi elle est proposée : même lieu, même profil de séjour, ou les deux.
- Donner un lien vers le bilan source et un lien vers l'historique filtré.
- Rester compact; permettre de consulter la suite quand le nombre d'observations dépasse
  la limite du résumé. Ne pas perdre le brouillon du plan pendant ce chargement.
- Un refus ou un échec du bilan ne bloque ni l'édition du plan, ni le reste de la préparation.
- Sans `camp_reviews.view`, ni bouton, ni appel API, ni texte de bilan dans une réponse
  de préparation déjà autorisée par d'autres permissions.
- Si le camp n'est encore qu'une activité non planifiée (`scheduled: false`), expliquer
  le besoin de le planifier avant un rapprochement par `meetingId`; ne jamais appeler une route avec `null`.

### 3. Réutiliser un camp

Au changement du camp source dans `spa/modules/yearly-planner/CampDuplication.js` :

- Lire et afficher son bilan clos, avec les mêmes groupes et le lien vers le détail.
- Afficher « Aucun bilan clos pour ce camp » lorsque c'est le cas.
- Changer rapidement de source ne doit jamais afficher le bilan de la source précédente :
  capturer l'identifiant, ignorer les réponses anciennes et les réponses après fermeture.
- La lecture a son propre état de chargement/erreur et ne modifie pas les cases de copie.
- Ne copier ni note, ni voix, ni tri, ni état clos, ni date de clôture dans le nouveau camp.
  Le bilan du nouveau camp commence vide et ouvert.
- Après copie du lieu, les recommandations du nouveau camp se recalculent sur ses données
  actuelles. Les notes de l'ancien séjour restent rattachées à leur origine.

## Contrats API proposés — à implémenter

| Route GET sous /api/v1/camp-reviews | Rôle |
| --- | --- |
| `/history?site_id=&season=&accommodation=&page=&limit=` | Historique paginé de l'unité; filtres facultatifs, strictement validés. |
| `/camps/:meetingId/lessons` | Recommandations pertinentes pour un camp de l'unité; cible explicite, sans année implicite. |
| `/camps/:meetingId` | Détail existant, aussi utilisé pour le bilan du camp source de duplication. |

Réponses par `paginated()` / `success()`; toutes les routes prennent `authenticate`
et `requirePermission('camp_reviews.view')`. Pas de nouvelle route d'écriture dans
cette tranche. Un identifiant de camp d'une autre unité répond 404. Les filtres
malformés répondent 400; l'absence de droit répond 403 avec `required` et `missing`.

Les recommandations exposent seulement ce qui sert à la préparation :
`source_meeting_id`, nom et dates du camp source, lieu/profil, raison de correspondance,
`note_id`, catégorie, `outcome`, texte, action et poids. Ne pas envoyer la liste nominative
des personnes ayant voté dans ce résumé.

### Sélection et pondération

1. Même `organization_id` sur chaque jointure; ne jamais accepter l'unité envoyée par le client.
2. Bilan source clos; camp source commencé strictement avant le camp cible; exclure la cible.
3. Notes racines uniquement, triées `keep` ou `fix`; ne pas proposer séparément les notes fusionnées.
4. Correspondance par lieu renseigné identique OU profil complet identique. Deux valeurs NULL
   ne constituent jamais une correspondance.
5. Compter les voix des notes fusionnées une fois, selon la formule de `campReviews.js`.
6. Dans chaque groupe, poids décroissant, puis camp source le plus récent, puis identifiant
   stable. Une correspondance par deux critères ne duplique pas la note.
7. Afficher les vrais poids de chaque bilan : ne pas sommer des observations semblables de
   camps différents et ne pas déclencher de traduction ou de rapprochement par IA.
8. L'historique conserve les bilans d'un camp ensuite marqué annulé, en le signalant.
   Les recommandations excluent les camps annulés pour éviter de conseiller depuis un séjour non tenu.

### Années scoutes et archives

L'historique est celui de l'unité. Ne pas filtrer par l'année du sélecteur et ne pas appeler
un helper créant une année active lors de cette lecture. Les en-têtes de contexte d'année
ne changent pas l'ensemble historique autorisé.

Auditer la lecture du détail existant avec `ScoutYearContext` : l'archive ne doit montrer
ni ajout, ni +1, ni tri, ni clôture/réouverture. Conserver le refus d'écriture global existant;
ne pas ouvrir une exception à `api-core.js` pour ce module.

Le cache de lecture doit rester isolé par compte et unité. Conserver la portée supplémentaire
par année des copies de préparation existantes : pas de migration silencieuse de leurs clés.
Une clôture ou réouverture rend l'historique et les recommandations périmés; une réouverture
retire immédiatement le bilan des résultats au prochain rafraîchissement.

## Découpage de réalisation

| Étape | Changements | Validation ciblée |
| --- | --- | --- |
| A. Lectures serveur | Service `campReviewHistory.js`, routes GET, filtres/pagination, contrat API | Routes 401/403/404/400, vrais jeux de bilans sur PostgreSQL, poids et isolation entre années/unités. |
| B. Historique | `CampReviews.js`, route SPA, lien depuis CampPlans, filtres, traductions, styles | jsdom, axe, navigation clavier, échappement et états; ajout à `SCREENS` et données fictives dans le seed. |
| C. Préparation | Composant partagé de recommandations dans CampPlan et CampReadiness | Droits, camp sans profil, activité non planifiée, erreur indépendante, brouillon et focus conservés. |
| D. Duplication | Aperçu du bilan source dans le dialogue existant | Changement de source concurrent, fermeture pendant lecture, clavier/axe, absence de copie des bilans. |

Une branche de réalisation basée sur la dernière version stabilisée de #1403 suffit.
Publier des commits séparés par étape. Ouvrir la PR de réalisation seulement sur demande;
si #1403 n'est pas encore fusionnée, signaler explicitement cette dépendance au lieu de
présenter le diff cumulé comme une tranche indépendante.

Aucune migration n'est nécessaire pour les lectures utilisant les champs existants.
Si les mesures PostgreSQL justifient un index, ajouter une migration idempotente et la rejouer
sur la base jetable; ne pas annoncer un index « nécessaire » sans avoir mesuré le chemin de lecture.

## Cas de non-régression à ajouter

- Deux années scoutes de la même unité : un seul historique identique, même dans une archive.
- Un autre compte ou une autre unité ne reçoit aucun résumé, filtre ou camp source étranger.
- Un bilan rouvert disparaît de l'historique clos et des enseignements; il reste lisible en détail.
- Une note fusionnée et ses voix pèsent une seule fois dans le résumé.
- Une note détachée redevient une note distincte avec sa version et ses voix; un enfant supprimé reste absent.
- Même lieu et même profil simultanément : une seule observation; lieu/profil manquants : aucun rapprochement par NULL.
- Un camp futur ou le camp cible lui-même ne sert jamais de source.
- Un lieu archivé reste présent dans l'historique; il ne devient pas à nouveau sélectionnable à la copie.
- L'échec de lecture des enseignements n'empêche pas d'enregistrer un plan ou de copier les parties autorisées.
- Une réponse tardive après changement de source, changement d'unité ou fermeture du dialogue est ignorée.
- Le dialogue ne double pas ses écouteurs; Tab et Échap fonctionnent et le focus revient au déclencheur.
- L'historique, le résumé et le dialogue restent utilisables à 390 px sans défilement horizontal.
- Aucun changement des garanties hors ligne et de rejeu acquis dans #1376 et #1403.

Exécuter localement uniquement les tests liés et les contrôles applicables de CLAUDE.md.
L'intégration relative aux archives/années exige PostgreSQL réel. La CI du commit publié reste
la validation complète : qualité, build, intégration et navigateur WCAG 2.2 AA.

## Frontière avec #1320 et reste de #1257

Cette tranche ne crée pas le document de permis, sa checklist complète, ses approbations
ou ses signatures. Elle conserve le lien « Évalué » déjà livré et rend l'état du bilan
disponible à la future checklist de #1320. « Évaluation prévue » et « Bilan clos » sont
deux faits distincts, jamais une seule coche déduite d'un champ non vide.

Le rattachement fin d'une note à une ligne d'horaire, un article de matériel ou un lot
reste demandé dans #1257 mais n'est pas livré par #1403. Ne pas fermer #1257 avec cette
tranche sans traiter ce reliquat ou le déplacer explicitement dans une issue de suivi.
