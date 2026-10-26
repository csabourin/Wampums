# Authoring the starter activity catalogue

`config/activity_library_starter.json` is the versioned bilingual source for
starter activities. It contains no unit data. The application does not yet
import it; issue [#1262](https://github.com/csabourin/Wampums/issues/1262) tracks
that work. Editing the source must not silently update existing unit copies.

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

## Validation

Run `npx jest --runInBand test/activity-library-starter.test.js` after editing
content. It checks completeness, language structure, declared vocabulary,
legacy-name uniqueness, retirement records and the selected floor-based pigeon
setup. Tests cannot certify practical safety or prove translation meaning.

When implementing import, preserve content fields and review states, respect
withdrawn entries, and select language using the unit's fallback. Preserve the
stable source key while allowing local edits without changing the source or
another unit's copy.
