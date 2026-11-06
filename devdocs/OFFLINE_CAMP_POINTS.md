# Points hors ligne en camp

La sélection permet de combiner plusieurs participants avant une attribution.
Après un ajout ou un retrait de points, les destinataires restent sélectionnés
pour permettre une correction immédiate. Le prochain clic sur un participant ou
un groupe commence une nouvelle sélection, même si l'envoi attend encore le réseau.
Un refus d'envoi conserve la sélection pour réessayer. Le focus et le survol
utilisent un contour ; seul l'état sélectionné remplit la ligne de couleur.

Les ajouts et retraits de points sont conservés dans la file IndexedDB de la SPA,
associés au compte et à l’unité. Chaque lot porte un `Idempotency-Key` dès le premier
envoi : `point_mutation_receipts` et les points sont validés dans la même transaction.
Une réponse perdue peut donc être retransmise sans doubler les points. Déployer la
migration `044_point_mutation_receipts.sql` avant le nouveau client.
Les totaux mis en cache par la préparation sont ceux de l'année scoute active, comme
`GET /api/v1/points` ; en ligne, l'écran des points recharge toujours les totaux du serveur.
Une présence verrouille l'inscription du jeune avant de comparer son statut : deux appareils
qui marquent le même jeune au même moment ne donnent les points de présence qu'une fois.
Les onglets ouverts partagent une seule file : un seul à la fois la rejoue (Web Lock
`wampums-offline-outbox-replay`), les autres n'envoient rien et réessaient plus tard.
L'onglet qui rejoue relaie `offlineMutationReplayed` / `offlineMutationRejected` aux autres
(BroadcastChannel `wampums-offline-outbox`) : l'écran qui a mis un changement en file
l'apprend même si un autre onglet l'a envoyé.
`attendance.points_awarded` (migration 047) retient les points qu'une présence a donnés :
un changement de statut ou une journée supprimée reprend exactement ceux-là (une journée
reprise de la veille n'en donne aucun). Un niveau de badge donne ses points une seule fois
(`badge_progress.points_awarded`, migration 048), même approuvé de nouveau.

Les camps des sept prochains jours se préparent automatiquement lorsque la SPA
est ouverte avec du réseau, pour les comptes ayant `activities.view` et une portée
unité. `CampPreparation` vérifie les données IndexedDB, les écrans, les traductions
et le document HTML en cache avant d'annoncer « Prêt hors ligne sur cet appareil ».
Les préparations et le mode camp sont isolés par compte, unité et année scoute ;
un ancien indicateur sans preuve ne suffit pas. Les données sont actualisées chaque
heure et après synchronisation, avec une nouvelle tentative chaque minute en cas
d'échec. Une file locale non vide reporte le téléchargement pour préserver les
modifications. Les camps futurs n'activent le mode camp qu'à leur début.
Le tableau de bord n'affiche la disponibilité hors ligne d'un camp que de 24 heures avant son début
jusqu'à sa fin (`isCampReadinessDue`) ; la préparation, elle, commence plus tôt en arrière-plan.
« Vérifier la disponibilité hors ligne » permet une actualisation manuelle depuis
les activités ou la préparation hors ligne ; vérifier chaque appareil avant de partir.
Les totaux locaux restent
consultables après expiration du cache tant que l’appareil est hors ligne ou qu’un
lot attend son envoi. La SPA ouverte synchronise au retour du réseau, à son retour
au premier plan et réessaie toutes les 30 secondes. Garder les présences avant les
points dans la file ; une erreur temporaire suspend les opérations suivantes.
Les refus définitifs sont annoncés et les totaux sont rechargés après synchronisation.
