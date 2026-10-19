# Année scoute — règles

Comment l'application gère l'année scoute : rentrée, consultation des années passées, annulation,
départs, alumni, transferts, effacement. Le schéma est dans `attached_assets/Full_Database_schema.sql`
et `migrations/`, le comportement est fixé par les tests (`npm run test:scout-year` et
`test/spa/ScoutYear*.test.js`). Ce document garde les décisions et leur raison. La conception initiale,
les étapes de livraison et l'application en production (2026-08) sont dans git.

## Principe

> **Rien n'est supprimé. Ce qui change, c'est l'année qu'on regarde.**

L'année scoute est une dimension de premier rang. « Repartir à zéro » à la rentrée veut dire changer
d'année : les totaux de la nouvelle partent de zéro, ceux de l'an dernier restent consultables. C'est
aussi ce qui rend la transition réversible, donc faisable en un clic. La seule exception est
l'effacement à la demande d'une famille (voir *Effacement*).

## Modèle

- `scout_years` : une seule année `active` par unité, sans chevauchement (`scout_years_no_overlap`).
  Les bornes viennent du réglage `fiscal_year`. **L'année active contient toujours aujourd'hui** : une
  transition lancée en avance ramène la date de début au jour du clic.
- `participant_enrollments` : une inscription par jeune, par unité et par année, avec `status`
  (`active`, `graduated`, `left`, `transferred`). **La vue `participant_organizations`** en donne
  l'effectif de l'année active, pour les lectures. Les écritures visent la table. Retirer un jeune
  ferme son inscription (`left`) au lieu de la supprimer.
- `participant_group_assignments` : les affectations aux tanières, par année, avec la vue de
  compatibilité `participant_groups`. On écrit toujours dans l'année **en cours**, jamais dans une
  archive. Les tanières (`groups`) gardent leur nom d'une année à l'autre ; les affectations et rôles de
  sizainier repartent de zéro, sans reconduction.
- `points.scout_year_id` est posé par un trigger sur tout insert ; les totaux de la saison lisent
  `active_year_points`. Présences et honneurs n'ont pas de colonne d'année : ils sont bornés par les
  dates de l'année. Une saisie rétroactive datée de l'an dernier compte donc dans l'année précédente.
- `user_organizations.status` : `active`, `inactive` ou `alumni`. Un membership non actif ne passe plus
  `authenticate`, ne reçoit plus d'annonce ni de notification, et garde intacts ses liens et son
  historique. Il est réactivable.
- `scout_year_transitions` : le journal des transitions, avec un `changeset` assez complet pour
  rejouer l'inverse.

## Ce que veut dire « l'effectif d'une année »

Sur l'année en cours, c'est qui est inscrit **maintenant** : un jeune parti en novembre n'y est plus.
Sur une année close, c'est **tout le monde** qui en a fait partie, y compris les sortants. Sans cette
distinction, on ne retrouverait pas un ancien jeune dans son année. Côté serveur, `withScoutYear(pool)`
(`middleware/auth.js`) résout l'année demandée et pose `req.scoutYear` et `req.rosterStatuses`, que les
requêtes utilisent. Une année inconnue ou d'une autre unité donne un 400.

Sont bornés par l'année : participants, présences, honneurs, points, rapports et tableau de bord parent.
Finance, covoiturages, badges, formulaires, ressources et activités répondent pour l'année active ; on
peut les convertir un par un sur le même modèle.

## Consulter une année passée

- L'année consultée se choisit dans `spa/modules/scout-year/ScoutYearBanner.js`, hors de `#app` pour
  survivre à la navigation, et se retient dans `ScoutYearContext.js`. Choisir l'année active efface la
  sélection : aucun en-tête n'est alors envoyé et le cache habituel sert.
- En archive, `getAuthHeader()` ajoute `x-scout-year-id`, la clé de cache reçoit un suffixe d'année, et
  **`makeApiRequest()` refuse toute écriture**. La garde est dans la couche API : le serveur estampille
  les écritures avec l'année active, si bien qu'un bouton oublié écrirait sans bruit dans la saison en
  cours.
- `ArchiveReadOnly.js` désactive les contrôles de `#app` à chaque rendu. Les contrôles qui servent à
  consulter (date, recherche, filtre) portent `data-archive-safe` et restent actifs.

## La transition de rentrée

Assistant `spa/modules/scout-year/ScoutYearTransition.js` (route `/scout-year`), permissions
`scout_year.view` (historique) et `scout_year.manage` (exécution).

1. **Effectif** — le serveur propose une disposition pour chaque jeune selon le réglage
   `year_transition` (âge limite et date de référence, propres à chaque unité). Les jeunes qui demandent
   une décision viennent en premier. Un jeune **sans date de naissance n'est jamais sorti d'office** : il
   est marqué `needs_review`. Garder un sortant par exception demande une note facultative.
2. **Conséquences** — recalculées à partir des choix réellement faits. Les parents qui n'ont plus
   d'enfant inscrit passent à `inactive` par défaut, chacun décochable.
3. **Confirmation**, puis exécution en une seule transaction.

Garde-fous, appliqués dans le SQL et pas seulement dans l'interface :

- **On ne désactive jamais un compte qui détient un rôle autre que parent**, quoi qu'envoie le client.
- Les formulaires requis des jeunes reconduits ne sont pas vidés : ils passent à `needs_review`. Le
  parent confirme sans changement ou met à jour, et les deux écrivent `last_reviewed_at` **sans toucher
  `updated_at`**, car « relue » n'est pas « modifiée ». C'est un signal, pas un blocage, et il n'y a pas
  de relance automatique.
- **Les autorisations médicales expirent et exigent une nouvelle signature**, sans bouton « confirmer
  sans changement » : une signature engage. Les tables d'autorisation sont en ajout seul ; l'ancienne
  signature reste au dossier.
- Badges et progression du programme sont des acquis : ils ne sont pas remis à zéro, et ceux en cours
  se poursuivent.
- Rien qui envoie un courriel ne s'exécute dans la transaction.

## Annuler une transition

Possible **tant que la nouvelle année est vide**, sans limite de temps, et seulement pour la transition
la plus récente dont l'année est encore active. Le refus est un 409 qui **nomme** ce qui bloque, avec
un compte : points, présences, honneurs, inscriptions, affectations de tanière, formulaires, fiches
révisées, autorisations signées.

L'annulation rejoue le `changeset` à l'envers dans une transaction `SERIALIZABLE` : une écriture
concurrente devient un 409 plutôt qu'une perte silencieuse. L'année ouverte n'est pas supprimée, elle
repasse en `planning` et rend les jours empruntés à la précédente (rétrécie **avant** que la précédente
ne retrouve sa date de fin, sinon la contrainte de chevauchement se déclenche). `last_reviewed_at` n'est
pas touché : c'est un fait sur le parent, pas sur la transition.

## Alumni

Une famille dont le dernier enfant est parti garde son compte, `inactive`. Le statut `alumni` est une
relation qu'elle choisit (`services/alumni.js`, permission `alumni.manage`) :

1. **Jamais automatique.** La transition pose `inactive` et s'arrête là. L'invitation est proposée par
   un bouton du rapport de transition, envoyée une seule fois.
2. **Sans connexion.** L'accès vient d'être retiré, donc le lien porte un jeton signé qui ne nomme que
   le membership. La page publique demande un clic : un client de messagerie qui préouvre les liens ne
   doit pas consentir à la place de la personne. Le désabonnement agit au chargement.
3. **Le silence est un non.** Sans réponse, le membership reste `inactive`. La base refuse un statut
   `alumni` sans consentement.

Les annonces ont une audience (`members` ou `alumni`) : un envoi à l'unité n'atteint jamais les alumni,
et un envoi aux alumni passe par courriel seulement, avec un lien de désabonnement personnel. Écrire aux
alumni exige `communications.send` **et** `alumni.manage`. Les routes publiques répondent 200 quel que
soit le jeton, l'issue étant dans `state`, pour ne pas servir d'oracle.

## Transfert vers une unité sœur

`services/transfer.js`, permission `participants.transfer`, destinations limitées au même groupe local.

- **Le transfert emmène les parents.** Un parent laissé dans l'ancienne unité et absent de la nouvelle
  devrait être réinvité à la main, ce qui en pratique n'arrive pas. Un parent qui garde un enfant à
  l'origine reçoit une adhésion **de plus** ; un parent qui n'y a plus personne y est désactivé ; un
  compte qui détient un autre rôle n'est jamais touché.
- L'inscription d'origine est close (`transferred`), celle de destination ouverte dans l'année active
  de la cible, avec la **date d'inscription conservée** : l'ancienneté appartient au jeune.
- Les badges déjà approuvés suivent l'enfant lorsqu'un modèle correspondant existe dans l'unité
  d'arrivée. Les étoiles sont recopiées dans le dossier de destination comme historique, sans points
  additionnels ni remise physique marquée. Les demandes en attente restent à l'origine. Les badges
  sans modèle correspondant ne sont pas copiés et sont comptés dans `badges_unmatched`.
- Ne suivent pas : les formulaires (remplis pour l'autre unité, leur nombre est indiqué), la tanière,
  les points, les présences, les honneurs, les frais et soldes (dus à l'unité qui les a facturés).
- Le serveur est complet ; l'écran appartiendra à l'espace district. `spa/api/api-transfers.js` est
  déjà en place pour lui.

## Effacement

`services/erasure.js`, permission `participants.erase` (administrateurs d'unité et district, jamais un
animateur), et le nom complet du jeune saisi et vérifié par le serveur. C'est le seul endroit qui
détruit vraiment des données : masquer les lignes ne serait pas un effacement.

- Part : le jeune et tout ce qui en dépend, y compris ce qu'aucune clé étrangère ne cascade ; les
  tuteurs sans autre enfant ; les comptes parents sans autre enfant **et** sans autre rôle. Un compte
  conservé est signalé avec sa raison.
- Reste, anonymisé : ce qui pointe en `ON DELETE SET NULL` (une entrée de financement garde son montant,
  un rapport d'incident son récit). Le texte libre des rapports d'incident n'est pas expurgé ; leur
  nombre est signalé à l'administrateur.
- Un jeune inscrit dans plusieurs unités n'est effacé qu'après l'approbation de **chaque** unité qui
  détient des données sur lui. L'effacement a lieu à la dernière approbation.
- `erasure_log` garde qui, quand et combien, **jamais** un nom, un courriel ou un identifiant de
  participant.

## Limites connues

- **Rapports d'une année close** : ils désignent la soumission de formulaire en vigueur cette année-là,
  mais son contenu reste modifiable. Une fiche modifiée cette saison affiche le texte d'aujourd'hui. Il
  faudrait versionner les soumissions.
- **Frais** : `participant_fees` et `payment_plans` ne sont pas rattachés à l'année ; les soldes impayés
  restent tels quels. Voulu.
- **Historique de badges** : dans le suivi des badges, ouvrir la fiche d'un jeune et choisir « Mettre à
  jour l'historique » pour cocher plusieurs niveaux déjà obtenus. La date est facultative. Ces entrées
  sont approuvées comme historique, sans points; les niveaux déjà au dossier sont désactivés. Le rôle
  système `leader` peut gérer les badges; l'approbation demeure une permission distincte.
- **Conservation (Loi 25)** : pas de purge automatique après N ans. Une famille sans consentement alumni
  et sans enfant inscrit en serait candidate ; un alumnus consentant ne l'est pas.
