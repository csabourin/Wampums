# Authoring the starter activity catalogue

`config/activity_library_starter.json` is the versioned bilingual source for
starter activities. It contains no unit data. Units receive copies through
`services/activityLibraryStarter.js` (see [Copies in a unit](#copies-in-a-unit)).
Editing the source must not silently update existing unit copies.

## Content fields

- `version` identifies a content revision, not a database migration.
- `key` is stable across edits and translations. A rename must not change it.
- `branches`, `category`, `tags` and `seasons` use the bilingual vocabularies at
  the top of the file. Every entry declares an indoor or outdoor setting and
  at least one season. A season is a planning possibility, not a guarantee of
  suitable weather or site conditions.
- `duration.min` and `duration.max` are planning estimates in minutes. Specialist
  equipment and the site should be prepared before the session where indicated.
- `players.min` is an indicative minimum participant count, excluding leaders.
  For a parent meeting, it refers to attending adults. It is neither a staffing
  ratio nor a maximum group capacity.
- `supervision` is `standard` or `close`. Close supervision requires a competent
  adult to directly oversee the relevant station or action. Neither value
  replaces the unit's staffing and safeguarding rules.
- `origin` distinguishes existing unit activities (`units`) from new starter
  suggestions (`new`). `legacy_names` preserves exact old names for later
  matching. Names must be unique across active and withdrawn entries.
- `fr` and `en` each contain `name`, `summary`, `material`, `steps`, `safety`
  and `variants`. Align list items in meaning and number. An empty material
  list means no special equipment; an empty variant list means no additional
  variant is proposed.

## Review states

- `draft`: an editorial pass is still needed.
- `to_confirm`: a rule or fact is unresolved; describe it in `review_note`.
- `reviewed`: the bilingual editorial pass is complete. This is not approval
  by an association, evidence of field testing, or permission for a particular
  unit to run the activity.

Before marking an entry reviewed, check that a new leader can understand the
setup, sequence and ending. For games, explain scoring, restarts and return to
play. List material actually used and offer ways to pause, decline or adapt an
activity without humiliation. Do not invent unconfirmed local game rules.

For close supervision, identify the adult's responsibilities and stop
conditions. Use the actual equipment manual for launch distances, pressure
limits, fuel handling and failed-launch waits; do not invent universal values
for unspecified equipment. Current unit, association, site and equipment rules
still govern the decision to run the activity.

Keep first-aid introductions distinct from certification and use trained
instruction with practice equipment, without prescribing medical procedures.
Do not add a specialist activity such as swimming as a casual game variant.
The introductory compass and astronomy content assumes a Canadian setting and
must be adapted before use elsewhere.

Opening and closing spiritual moments are secular and optional: reflection,
gratitude or quiet listening without an imposed belief. Distinguish the
Association des scouts du Canada (ASC) from Scouts Canada when attributing
programme-specific terms. Use general team language for shared activities;
retain a branch-specific tradition only where the entry intentionally describes it.

## Withdrawing an activity

When rules cannot be established and withdrawal is chosen, remove the entry
from `activities` and preserve its key, `legacy_names` and bilingual `reason`
in `retired_activities`. The latter is a matching record, not a selectable
catalogue. Do not recycle a withdrawn key or alias for another game or equate
two games solely from a similar name.

Future import code must not auto-copy retired entries, silently map them to
another game or delete a unit's existing local copy. Restoring an entry requires
verified rules and a separate content decision. Do not invent a replacement
solely to maintain a catalogue count.

## Reference material

Consult primary sources when checking specialist precautions. They are not incorporated
as association policy, and UK requirements are not presented as Canadian law.
The text is an original bilingual summary, not a reproduction of the sources.

| Area | Reference | Scope |
| --- | --- | --- |
| Planning and supervision | [ASC, Guide de gestion du risque](https://scoutsducanada.ca/content/uploads/2023/08/ASC_Guide_de_gestion_du_risque-1.pdf) | Site inspection, competent support, supervision and intervention planning. |
| Knife handling | [The Scouts, additional tips for safe knife use](https://www.scouts.org.uk/volunteers/staying-safe-and-safeguarding/safety/safe-camping-residentials-and-outdoor-skills/scout-knife-safety-guidance/some-additional-tips-for-safe-knife-use/) | Clear cutting space, blade direction, secure storage and passing. |
| Fire and campfire evening | [The Scouts, campfire safety](https://www.scouts.org.uk/volunteers/staying-safe-and-safeguarding/safety/safe-camping-residentials-and-outdoor-skills/campfire-safety/) | Separate fire responsibility, boundaries and supervised extinction. |
| Stove cooking | [The Scouts, using stoves safely](https://www.scouts.org.uk/volunteers/staying-safe-and-safeguarding/safety/safe-camping-residentials-and-outdoor-skills/using-stoves-safely/) | Outdoor location, manufacturer instructions and cooling before refuelling. |
| Model rockets | [NASA Glenn, model rocket safety](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/model-rocket-safety/) | Commercial equipment, launch control and obstacle-free recovery. Water-launch equipment requires its own manual. |
| Shore fishing | [RLSS UK, water safety advice for anglers](https://www.rlss.org.uk/water-safety-advice-for-anglers) | Stable footing, flotation, staying together and shore-based help. |
| First-aid introduction | [Canadian Red Cross, youth safety courses](https://www.redcross.ca/training-and-certification/first-aid-and-safety-courses/children-youth-caregiver-safety-courses/) | Age-appropriate introduction, distinct from certification. No medical procedure is prescribed by this catalogue. |
| ASC cub progression | [ASC, Les Louveteaux](https://scoutsducanada.ca/badge/les-louveteaux/) | Attribution of the hunting-ground programme to ASC. |

## Copies in a unit

`services/activityLibraryStarter.js` is the only code that copies the catalogue
into `activity_library`. The yearly planner's starter screen
(`/yearly-planner/starter-activities`), unit creation (`POST /api/v1/organizations`)
and the seeded demo unit (`.claude/skills/run-wampums/seed.mjs`) all call it.

- **Endpoints.** `GET /api/v1/yearly-planner/starter-activities` describes the
  catalogue in the unit's language, with each entry's standing in the unit.
  `POST /api/v1/yearly-planner/starter-activities/import` with `{ "keys": [...] }`
  copies entries. Both require `meetings.manage`; the import also passes
  `blockDemoRoles`. A malformed, unknown or withdrawn key answers 400
  `invalid_starter_selection`, with `errors[].code`, and nothing is written.
  The SPA never queues an import offline (`ONLINE_REQUIRED_MUTATION_RESOURCES`).
- **What a copy holds.** `name` and `description` (the summary) in one language,
  `category` (the catalogue key, translated on screen through
  `spa/utils/ActivityLibraryUtils.js`), `tags`, the duration range, `material`
  (one item per line), and in `metadata`: `starter_key`, `starter_version`,
  `starter_language`, `steps`, `safety`, `variants`, `branches`, `seasons`,
  `players_min` and `supervision`.
- **Language.** The unit's `default_language` when it is `fr` or `en`; otherwise
  the `fallback` of its `interface_languages` setting, else English.
- **One copy per unit.** `metadata.starter_key` is unique per unit (migration
  053), hidden copies (`is_active = FALSE`) included. Imports run in one
  transaction behind a per-unit advisory lock; repeats, retries and concurrent
  requests report `already_present` instead of copying again. The generic
  library endpoints cannot set or change `starter_key`.
- **Older copies.** An unlinked row whose name is exactly one of the entry's
  `legacy_names` is adopted (`reconciled`): the key is attached and the unit's
  text is left as it is. A deleted row yields to one still in use; two rows of
  the same standing are reported as `ambiguous` and neither is changed, until
  the unit deletes the extra one. Withdrawn entries' names are never matched.
- **Hidden copies.** Deleting an activity hides it. An explicit import of that
  entry shows the same copy again (`restored`); automatic installation leaves it
  hidden (`hidden`). Neither creates a second copy.
- **Default selection.** A new unit receives the entries for its program section
  (`beavers`, `cubs`, `scouts`) that need only standard supervision. A unit
  without a catalogue branch (`general`, venturers, rovers; new units start as
  `general`) receives those suited to all three branches. Close-supervision
  activities are always a deliberate choice. Meeting blocks suit every branch,
  so every unit receives them. Installation is idempotent.
- **Local edits.** A copy belongs to its unit: editing it changes neither the
  catalogue nor any other unit, and keeps its `starter_key`. A new catalogue
  `version` never rewrites existing copies.

## Meeting templates

`starterBlocks` in `config/meeting_sections.json` (mirrored in
`config/meeting_sections.js`) maps a template's `activityKey` to a catalogue
key: arrival (`activity_welcome_cubs` → `block_arrival`), water break
(`block_water_break`) and closing (`activity_prayer_departure` →
`block_closing`). No template configures an opening yet; `block_opening` is
available to add from the library. A template may also name `starterKey`
itself. Meeting preparation then uses the unit's own copy of the block, its
name, summary and precautions, so the closing's note that the spiritual moment
is secular and optional reaches the leader. A template the unit renamed
(`activity`) keeps its own text and is not linked. The mapping is keyed by
`activityKey`, so it covers every configured section (`general`, `beavers`,
`cubs`) and the units' stored copies of them. A section without templates of its
own (`scouts`, venturers, rovers) uses the default section's (`cubs`), and the
same links apply.

## Validation

Run `npx jest --runInBand test/activity-library-starter.test.js` after editing
content. It checks completeness, language structure, declared vocabulary,
legacy-name uniqueness, retirement records and the selected floor-based pigeon
setup. Tests cannot certify practical safety or prove translation meaning.

The import is covered by `test/activity-library-starter-service.test.js`,
`test/routes-starter-activities.test.js`,
`test/activity-library-starter.integration.test.js` (needs
`TEST_DATABASE_URL`) and `test/spa/StarterActivities.test.js`.
