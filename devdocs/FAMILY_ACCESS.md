# Family access

How a family gets into Wampums and who can see which child. Introduced by
[#1036](https://github.com/csabourin/Wampums/issues/1036).

This document records the model and the decisions behind it. Endpoints live in
the route modules, schema in `migrations/007_parent_invitation_onboarding.sql`,
and verified behaviour in the integration suites listed at the end.

## The three journeys

**An administrator invites a parent.** The invitation is a row in
`parent_invitations`, not an account. Nothing about a real person exists until
the recipient opens the emailed link and completes the form. Accepting creates
(or attaches) the account, gives it a parent membership in the unit, and links a
`parents_guardians` contact record, in one transaction.

**A parent registers their children.** A name and a birth date per child, under
`participants.create_own`. The child is enrolled in the active scout year and
linked to the parent in the same transaction. The full registration paperwork
remains the existing form, one link away.

**Two parents share a family.** One asks by email address; the other reads what
sharing means and accepts or declines. Only acceptance moves access.

## Decisions

**A pending invitation is not an account.** Public registration creates a user on
the spot, which is right for someone filling the form themselves and wrong for an
address somebody else typed. An account would exist that its owner never asked
for.

**Emailed links are opaque tokens, not JWTs.** Invitations and requests have a
life — withdrawn, superseded by a resend, spent on first use — and a signed token
stays valid until it expires whatever the database says. Only the SHA-256 digest
is stored. See `utils/invitation-tokens.js`.

**Opening a link changes nothing.** Mail scanners fetch links before people do.
Every link has a `GET …/describe` that writes nothing and a `POST` that acts.

**An existing account keeps its password and profile.** Accepting an invitation or
a family link with an address that already has an account asks only for
confirmation. An invitation is not authority to rewrite either.

**A hand-deactivated member is reinstated knowingly.** Inviting an address whose
membership an administrator closed by hand stops with the date and reason of that
closure. The inviting administrator must confirm, with a written reason, which is
stored on the invitation. Acceptance then restores the membership. A removal made
*after* the invitation was sent was never confirmed, and still goes to the
approval queue. A parent's family-link request can never readmit such a member.

**A child is one person.** A child registered by a parent who already has them in
another unit is enrolled in the new unit, not created again. Forms, medical record
and history stay on one `participants` row.

**Access records its reason.** `participant_access_grants` holds one row per
reason a person can see a child (`direct`, `guardian`, `admin`, `family_link`).
`user_participants` is the cache the rest of the app reads, and only
`services/participantAccess.js` writes it. This is what lets ending a family link
remove exactly what that link gave, while access the same person holds for any
other reason stays.

**A family link shares each side's own children in that unit, both ways.** Not
children held through another link — access does not travel from A to B to C.
Not children in other units — the link is consent about one unit. Not
guardianship — a partner sees a child's file without joining the emergency
guardians list.

**Duplicates are flagged, never merged.** Two records with the same name and
birth date, visible to one family, go to `participant_duplicate_candidates` for
an administrator of the unit to judge. This includes a partner's record in
another unit, which the parent is never shown. "Same child" records a decision;
merging the records across the tables that reference a participant is a separate
operation that does not exist yet.

**Duplicate rules are family-shaped.** Two unrelated families may each register
a child with the same name and birth date, and neither is told the other exists.
Within a family: same name and birth date on this year's roster is refused; the
same child from last year or another unit is re-enrolled; same name with another
birth date asks the parent.

## Permissions

| Permission | Used for |
|---|---|
| `users.invite` | Inviting parents |
| `participants.create_own` | Registering one's own children, sharing a family |
| `participants.edit` | Reviewing duplicates; changing any child of the unit through `/participants/save`, including their den |

`participants.create` is unscoped and must not be widened to make a parent
feature work. Parents who hold it (the paperwork form needs it) can edit only
children they are already linked to.

## Where it is verified

- `test/parent-invitations.integration.test.js`
- `test/parent-onboarding.integration.test.js`
- `test/family-links.integration.test.js`
- `test/participant-access.integration.test.js`
- `test/participant-duplicates.integration.test.js`
- `test/spa/FamilyAccess*.test.js`, `test/spa/LoginOnboardingResume.test.js`

The integration suites run against a disposable PostgreSQL named by
`TEST_DATABASE_URL`, built from `attached_assets/Full_Database_schema.sql` plus
`npm run db:migrate:base`. Each suite confines its cleanup to the units and
addresses it created, so they can run in parallel against one database.
