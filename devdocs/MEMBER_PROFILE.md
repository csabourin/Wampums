# Personal contacts and health (#1359)

Account-wide records, never copied per unit. Migration 076 creates `member_profiles` (phone,
emergency contact and sharing consent, false by default) and `member_health_forms` (voluntary health
conditions, medications/instructions and support needs). Allergies remain in migration 074's
`member_allergy_declarations`: the existing self-only declaration is the allergies section of the
health form, not a second copy.

## Own account

`GET` / `PUT /api/v1/member-profile/me` and `/me/health` require current active membership through
`authenticate` and `requirePermission()`. They always select `req.user.id`; there is no route for
writing another member's contacts, health or consent. Demo accounts cannot write. The optional birth
date uses the existing account field `users.date_of_birth`. Contacts and health are offered on
`/account-info#my-profile` and `#my-health`; health and certifications remain offered to members who
are not only parents. A parent who volunteers also has a volunteer role and receives those sections.
The volunteer space has one **My profile** entry explaining its contents, rather than three entries
to the same account screen. All writes require a connection and are serialized on the account.

## Camp contacts

`GET /api/v1/volunteer-space/camps/:activityId/contacts` requires `volunteer_space.view` and the same
participation check as the camp itself (team seat or shift signup). Another camp or another unit
answers 404. The answer lists only currently active, consenting adults of this camp, excluding the
caller: name, nickname and phone. A known adult birth date is required both for the reader and the
listed member; minors and unknown ages never disclose or receive peer contacts. Health and emergency
contacts are never in this response. Revoking consent or leaving the unit removes the phone on the
next read. These contacts never enter IndexedDB or the service-worker cache; without a connection,
the screen explains that current consent cannot be checked, while the camp's schedule remains usable.

## Camp health

The camp roster includes `adult_health_forms` only with `camp_allergies.view` and organization scope,
under its existing `meetings.view` / `participants.view` gate. It reads personal health and emergency
contacts for active members of that camp's team only. Departed team members stay on the team list,
with no personal health information. An absent health form explicitly says it has not been completed.
Roster health reads are also network-only.

## Minimum age

`config/member_profile.json` sets the minimum volunteer age to 14. A known younger birth date is
refused on shift signup and camp team assignment (including a proposed birth date in the assignment).
The fourteenth birthday is accepted. Omitting a birth date on a team edit keeps the stored date;
explicitly clearing it checks the resulting unknown age and is permitted. Unknown ages remain
unverified under the existing camp rules.
The account advisory lock serializes age checks and self-written birth date changes across units.
The pre-existing camp manager birth-date editor remains available; it does not edit contacts, health
or consent.

## Verification

`test/member-profile.integration.test.js` checks real PostgreSQL membership, unit/camp isolation,
self-only writes, consent/revocation, health gates and minimum-age boundaries. Route tests exercise
authentication, demo restrictions and validation. Profile and volunteer-space jsdom suites cover
escaping, retry, late answers, single writes and axe. Both account and volunteer-space routes already
belong to the real-browser accessibility suite. `test/service-worker-personal-profile.test.js` checks
that these sensitive endpoints bypass offline caches.

The account now groups these forms by task rather than stacking every setting. Contact forms use
compact optional disclosures, with the same data and save contract; see `devdocs/ACCOUNT.md`.
