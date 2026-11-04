# Camp lists: youth, team, volunteers (#1319)

Part of the camp plan (#1316). The camp permit asks for the camp's youth and its team, to be compared
with the SISC. Delivered in slices; this file says what each one settled.

| Slice | Content | State |
|---|---|---|
| 1 | Youth taking part, named team (lead, leaders, camp aides), volunteers of the camp's shifts | Done |
| 2 | Adult certifications (first aid, lifeguard, winter…) and blocking gaps | To do |
| 3 | Allergies of youth and adults, behind a permission of their own | To do |
| 4 | Comparison with a recent SISC import | To do |

Decisions of 4 November 2026: the team is **named explicitly** for each camp; a camp aide's age comes
from an **optional birth date on the account**; allergies get a **new permission**, given by default to
the roles that already read health forms; certifications are **declared by the adult and verified by a
manager**, and only a verified one lifts a blocking gap.

## Screen

**`/camp-roster/:meetingId`** ("Camp lists"; `meetings.view` and `participants.view`, unit-wide scope),
opened from each camp of `/camp-plans`. It shows, in this order:

1. **To check**: what the lists cannot vouch for. The comparison with the SISC is always listed until
   slice 4 exists. Nothing on the screen says the camp is compliant.
2. **Youth taking part**, with their count and age on the camp's first day, and how the list was drawn
   up (permission requests, or the whole year's roster).
3. **Camp team**: each member's role and age on the camp's dates in words (minor, adult, age not
   verified). Someone with `meetings.manage` adds, changes and removes members in a dialog; removing is
   confirmed first.
4. **Volunteers of the camp's shifts**: names for holders of `volunteers.manage`, a count for anyone
   else (the rule of `devdocs/VOLUNTEERS.md`).

## Rules (`services/campRoster.js`, migration 072)

- **Youth** are the enrollments of the scout year covering the camp's first day, still enrolled then
  (`status = 'active'`, or ended on or after that day). When the camp's activity has issued permission
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
- **Gaps** (`gaps`): `no_scout_year`, `no_youth`, `no_lead`, `aide_age_unknown`, `member_left_unit`; the
  screen adds `sisc_not_compared`. An empty list is a gap, never "nothing to report".
- Writes lock the camp row; a cancelled camp answers 409 `camp_roster_camp_cancelled`. They need a
  connection (`camp-rosters` is in `CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES`) and refuse demo accounts.

## Tests

`test/camp-roster.integration.test.js` (youth by enrollment and signed requests, a youth in two units,
role scope, unit isolation, ages, volunteer names), `test/routes-camp-rosters.test.js`,
`test/spa/CampRoster.test.js` (axe, dialog keyboard, escaping, field errors), and the screen in
`e2e/accessibility.spec.mjs` on the seeded camp.
