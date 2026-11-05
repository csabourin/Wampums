# Camp lists: youth, team, volunteers (#1319)

Part of the camp plan (#1316). The camp permit asks for the camp's youth and its team, to be compared
with the SISC. Delivered in slices; this file says what each one settled.

| Slice | Content | State |
|---|---|---|
| 1 | Youth taking part, named team (lead, leaders, camp aides), volunteers of the camp's shifts | Done |
| 2 | Adult certifications (first aid, wilderness first aid, winter camping), blocking gaps, swimming | Done |
| 3 | Allergies of youth and adults, behind a permission of their own | Done |
| 4 | Comparison with a recent SISC import | To do |

Decisions of 4 November 2026: the team is **named explicitly** for each camp; a camp aide's age comes
from an **optional birth date on the account**; allergies get a **new permission**, given by default to
the roles that already read health forms; certifications are **declared by the adult and verified by a
manager**, and only a verified one lifts a blocking gap.

## Screen

**`/camp-roster/:meetingId`** ("Camp lists"; `meetings.view` and `participants.view`, unit-wide scope),
opened from each camp of `/camp-plans`. It shows, in this order:

1. **To check**: what the lists cannot vouch for. Blocking gaps come first, each introduced by the word
   "Blocking:" (never by colour alone). The comparison with the SISC is always listed until slice 4
   exists. Nothing on the screen says the camp is compliant.
2. **Planned activities**: whether the camp plans swimming. A holder of `meetings.manage` ticks the box
   (saved at once; it goes back to what is recorded if the save fails); others read it.
3. **Youth taking part**, with their count and age on the camp's first day, and how the list was drawn
   up (permission requests, or the whole year's roster).
4. **Camp team**: each member's role and age on the camp's dates in words (minor, adult, age not
   verified), and, for holders of `meetings.manage` or `volunteers.manage`, the certifications verified
   for the camp's dates and those declared but still to verify. Someone with `meetings.manage` adds, changes and removes members in a dialog; removing is
   confirmed first. A cancelled camp says so and offers none of these changes.
5. **Allergies**, only for holders of `camp_allergies.view`: the youth whose health form declares one
   (allergies, auto-injector, reaction and what to do, and a link to the health form, which names the
   person to notify), the number of youth without a health form, and the team members' allergies as
   each declared them (auto-injector, person to notify), with the number who declared nothing.
6. **Volunteers of the camp's shifts**: names for holders of `volunteers.manage`, a count for anyone
   else (the rule of `devdocs/VOLUNTEERS.md`).

## Rules (`services/campRoster.js`, migration 072)

- **Youth** are the enrollments of the scout year covering the camp's first day, still enrolled then
  (`status = 'active'`, or ended on or after that day) and registered by its last day
  (`inscription_date`, when known): a youth registered after a camp never changes that camp's list. When the camp's activity has issued permission
  requests, only youth with a **signed** request are listed: a declined or revoked request is a
  withdrawal. Without requests, every enrolled youth is listed, as the action rosters do
  (`devdocs/ACTION_ROSTERS.md`). Every read is filtered by the camp's unit, so a youth enrolled in several
  units appears only in the camps of the units enrolling them.
- **Team** members (`camp_team_members`) are active members of the unit holding at least one role whose
  `data_scope` is not `linked`: a parent who is only a parent cannot be named, nor anyone from another
  unit (404 `camp_roster_member_not_found`). Roles: `config/camp_team.json` (`lead`, `leader`,
  `camp_aide`), the migration's check lists the same keys. A member who left the unit stays listed,
  marked, until removed.
- **Birth date** (`users.date_of_birth`) is optional, written by a camp manager in the team dialog. It is
  returned only to holders of `meetings.manage`; others see the age status alone. It belongs to the
  account, shared by every camp: a request without `date_of_birth` keeps it, `null` clears it. Adding a
  member with the field left empty sends none; emptying the date shown when editing clears it. A date in the future,
  or more than `oldest_age` years ago, is refused (400, field `date_of_birth`). Minor means under
  `adult_age` (18) on the camp's first day. Without a date, the age reads "not verified", never "adult",
  and a camp aide without one is listed to check.
- **Gaps** (`gaps`): `no_scout_year`, `no_youth`, `no_lead`, `aide_age_unknown`, `member_left_unit`,
  `no_first_aider`, `certification_to_verify`, `swimming_supervision`; the screen adds `sisc_not_compared`.
  `blocking_gaps` lists those the camp cannot leave without: today `no_first_aider` only
  (`BLOCKING_GAPS` in `services/campRoster.js`). An empty list is a gap, never "nothing to report".
- **Certifications** (migration 073, `member_certifications`, `services/memberCertifications.js`, keys in
  `config/certifications.json`): first aid (`first_aid_certificate`), wilderness first aid and winter
  camping. They **belong to the person**, not to a unit. An adult declares each **once** under
  "My certifications" on `/account-info` (`PUT /api/v1/member-certifications/me`, the complete set; the
  day obtained required, not in the future; an optional expiry not before it). The section is offered
  to anyone who is not only a parent. A declaration **never counts** by itself: a manager of volunteers
  of any unit where the person is an active member verifies it in the verify dialog of `/volunteers`
  (`PUT /api/v1/member-certifications/:userId/:key/verification`, `volunteers.manage`), and the
  verification then **holds in every unit** of that person. Changing a declaration's dates withdraws its
  verification. A unit reads a person's certifications only while they are its active member. A
  certification counts for a camp when it was obtained by the camp's **first** day, is verified, and is
  valid through its **last** day. A team member who left the unit stays listed without their certifications.
  `no_first_aider` holds while no active team member has a verified first aid or wilderness first aid
  certification; volunteers of the camp's shifts do not count. A declaration valid for the camp's dates
  but unverified is `certification_to_verify`.
- **Allergies** (migration 074): reading them takes `camp_allergies.view` (category `camp_plan`). The
  migration gave it to every unit-wide role holding `reports.view`, `medication.view` or
  `medication.manage`, or allowed to view the unit's `fiche_sante` form; a role of `linked` scope never
  receives it, and the route reads them for the camp's unit only. Without it, `allergies` is `null`; the
  gaps stay. **Youth**: the latest `fiche_sante` submission of the camp's unit, read with
  `utils/health-form.js` (`declaresAllergy`, the rule of the allergy report: anything said about an
  allergy lists the youth). A youth without one is `youth_health_form_missing`, never "no allergy".
  **Adults**: `member_allergy_declarations`, written only by the adult under "My allergies" on
  `/account-info` (`GET`/`PUT`/`DELETE /api/v1/member-allergies/me`; no route takes another person's
  id). It belongs to the person, shared by every unit they belong to: allergies (required, up to 1,000 characters), auto-injector,
  person to notify (optional, up to 200). Only active team members' declarations are listed; any active
  member without one is `adult_allergies_not_declared`. Withdrawing a declaration removes it from every
  list at once.
- **Swimming** (`year_plan_meetings.swimming_planned`, `PATCH /api/v1/camp-rosters/:meetingId`,
  `meetings.manage`): when planned, `swimming_supervision` is listed to check. It is never blocking:
  no lifeguard certification is recorded. A cancelled camp answers 409.
- Writes lock the camp row; a cancelled camp answers 409 `camp_roster_camp_cancelled`. They need a
  connection (`camp-rosters` is in `CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES`) and refuse demo accounts.

## Tests

`test/camp-roster.integration.test.js` (youth by enrollment and signed requests, a youth in two units,
role scope, unit isolation, ages, volunteer names), `test/member-certifications.integration.test.js`
(declared versus verified, new dates withdrawing a verification, validity through the last day,
wilderness first aid, a member who left, a verification holding in another unit, who verifies, swimming), `test/camp-allergies.integration.test.js` (the default
grant, health forms of the camp's unit, declarations of active members only, withdrawal, who reads),
`test/routes-member-allergies.test.js`, `test/spa/AllergyPanel.test.js`, `test/routes-camp-rosters.test.js`,
`test/routes-member-certifications.test.js`, `test/spa/CampRoster.test.js` (axe, dialog keyboard,
escaping, field errors, blocking gaps, swimming), `test/spa/CertificationsPanel.test.js`, and the screen
in `e2e/accessibility.spec.mjs` on the seeded camp.
