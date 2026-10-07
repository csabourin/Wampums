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

**Corrections and withdrawals are explicit.** Outstanding invitations can be
edited and sent again in the recipient's chosen language. Every save rotates the
link. Changing the address creates a new invitation, transfers its children,
and revokes the old invitation in one transaction, retaining its history.

Parents can correct children they can see in the unit; withdrawing an enrollment
requires independent access, not access borrowed through family sharing. A
withdrawal closes only the active year's enrollment. It keeps historical records
and family access, and the same child can be re-enrolled later. Walk-in staff can
correct or withdraw children before an account gains access. Withdrawal detaches
the child's outstanding invitations, revoking an invitation only when it has no
remaining children. Staff may also withdraw a whole child invitation while
keeping all of its children on the roster.

**Contact removal and access removal have different meanings.** Removing a
guardian relationship revokes that relationship's grants for that child, never
for siblings. Independently granted account access survives, and the response
reports it so the interface can explain that account–child management is needed
to remove it. Guardian removal respects the caller's data scope.

**Feedback distinguishes saved changes, delivery and refresh.** A failed email
send remains a saved invitation with a resend option. A failed list refresh
after a successful write offers a read-only retry. Connection failures while
opening emailed links are retryable load errors, not invalid-link states.
Writes on family screens are serialized while pending. Invitations, family
sharing and child management require an online server result and are never
silently queued for offline replay. A lost response reports an unconfirmed
operation and asks the user to refresh before retrying.

**Registration paperwork is resumable.** Core child creation/enrollment and
family linking are transactional. The existing paperwork and guardian requests
remain separate saves: a later failure keeps the entered fields, the saved
child ID and saved guardian IDs, and explains that registration is incomplete.
Saving again updates those same records. Adding or removing a guardian captures
all current drafts before rebuilding the forms. Paperwork saves require a
confirmed online response rather than reporting queued writes as complete.

## Permissions

| Permission | Used for |
|---|---|
| `users.invite` | Inviting parents; editing, resending and withdrawing outstanding invitations |
| `participants.create_own` | Registering and correcting family children; withdrawing independently held children's active-year enrollments; sharing a family |
| `participants.walk_in` | Entering walk-in children; correcting or withdrawing children without an account; resending or withdrawing their invitations |
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
- `test/walk-in-children.integration.test.js`
- `test/guardians-access.integration.test.js`
- `test/spa/FamilyAccess*.test.js`, `test/spa/LoginOnboardingResume.test.js`
- `test/spa/FamilyWorkflowUX.test.js`, `test/spa/FamilyOnlineWrites.test.js`

The integration suites run against a disposable PostgreSQL named by
`TEST_DATABASE_URL`, built from `attached_assets/Full_Database_schema.sql` plus
`npm run db:migrate:base`. Each suite confines its cleanup to the units and
addresses it created, so they can run in parallel against one database.
