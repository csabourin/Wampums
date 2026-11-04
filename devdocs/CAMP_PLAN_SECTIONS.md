# Camp plan: written sections

Issue #1318, part of the camp plan (#1316). The camp permit asks the team to write sections no
other screen holds. Two kinds coexist:

- **the camp's own:** V.C.P.R.E.F. (Wanted, Chosen, Prepared, Carried out, Evaluated, Celebrated:
  six named fields, each with its help), story or theme, motivation system;
- **stable from year to year:** rules of life, camp rules, code of ethics, in case of emergency.
  The unit writes them once as **templates**; every camp follows them unless it writes its own.

Plus the **games for bad weather**, chosen from the unit's activity library (`activity_library`)
with their material and how they run, rather than retyped.

Section keys are `config/camp_plan.json`, read by the server and the SPA; migration 071's checks
list the same values.

## Screens

- **`/camp-plan/:meetingId`** (`meetings.view`; writing takes `meetings.manage`): opened from the
  camp schedule and the camp overview. The plan is shown **one part at a time** (V.C.P.R.E.F., story
  and motivation, rules and emergencies, bad-weather games), with a quick navigation saying in words
  what each part still lacks, and previous/next buttons at the end of each part. Parts are hidden, not
  redrawn, so switching keeps unsaved text; `?part=` names the part shown, and the camp overview links
  each missing section to its part. Each section says where its text comes from: *to write*,
  *written*, *unit template*, *modified for this camp*, or *copied, to reread*. Each saves on its own
  and redraws alone, so saving one never discards what is typed in another. A text modified for
  the camp offers "Use the unit's template again" (confirmed first). Saving a template unchanged
  does not make it "modified". Games are added from a list, moved up or down and removed with
  buttons (no drag). Under the motivation system, the unit's point rules are recalled (attendance,
  honours in the unit's vocabulary, badges), read from `point_system_rules`, never copied.
- **`/camp-plans`** (`meetings.view`; `GET /api/v1/camp-plans/camps`): every planned camp of the
  unit, coming ones soonest first, then the ten latest past ones (a cancelled camp is left out), each
  saying in words what its plan still lacks and leading to its plan, site and overview. Its tile,
  "Camp plans", sits in the dashboard's "Plan the year and the camps" section.
- **`/camp-plan-templates`** (`camp_plan_templates.manage`, migration 071, given to every unit-wide
  role holding `meetings.manage`; the district role through its trigger): the four templates, with a
  dashboard tile gated the same way, under "Unit administration" with the unit's other settings.

## Rules

- Rich text is rebuilt by `utils/richText.js` (`readRichTextField`) and stored with its plain
  version (`body_text`) for exports. An empty text is no row: a camp section is then to write again,
  a stable section follows its template again.
- Every write names the version it replaces (`expected_version`, 0 for none); a stale editor gets 409
  `camp_plan_version_conflict`, including two first writes of one template. Camp writes lock the camp
  row; a cancelled camp answers 409 `camp_plan_camp_cancelled`.
- A section with nothing to show, and a camp with no bad-weather game, are listed in `gaps.to_write`;
  the camp overview (`/camp-readiness`) shows them in "Written plan sections", never as complete.
  Copied sections are listed in `gaps.to_review` until saved again.
- A game must be an activity of the unit's library (a composite foreign key keeps it in the unit).
  One hidden from the library since stays on a camp that lists it, marked, but cannot be added. At
  most `RAIN_GAMES_MAX` games.
- **Templates and approved plans.** A camp reads its unit's current template; the answer carries
  `template_version`. Approval does not exist yet: the plan document and approval (#1320) must store
  the texts it approves, so that changing a template never changes an approved plan.
- **Reusing an earlier camp** (#1256) has a `plan` part: the camp's own sections are copied as drafts
  to reread (`needs_review`), and its games still offered. Stable sections are not copied: the new
  camp follows the unit's templates as they now are.
- Writes need a connection (`camp-plans` is in `CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES`).

## Not in this first version

- The optional AI draft of the V.C.P.R.E.F. or theme summary (`ai.use`): left for later.
- Linking "Evaluated" to the camp review (#1257): the field's help names it; the link comes with it.

Tests: `test/camp-plan.integration.test.js`, `test/routes-camp-plans.test.js`,
`test/spa/CampPlan.test.js`, `test/spa/CampPlanTemplates.test.js`, and both screens in
`e2e/accessibility.spec.mjs`.

## Rules summary

The binding rules for this area, formerly in CLAUDE.md.

`/camp-plan/:id` (`meetings.view`; writing takes `meetings.manage`) holds what the camp permit asks
the team to write (migration 071): V.C.P.R.E.F., theme, motivation, and the games kept for bad weather
from the unit's activity library. Rules of life, camp rules, code of ethics and emergency procedures
are the unit's templates (`/camp-plan-templates`, `camp_plan_templates.manage`): a camp follows them
unless it writes its own, and says so. Writes go through `services/campPlan.js` (rich text rebuilt,
version-checked, camp row locked); keys are `config/camp_plan.json`. An empty section is "to write"
in the plan and in `/camp-readiness`, never complete. Reusing a camp copies its own sections as
drafts to reread, never the stable ones. `/camp-plans` lists the unit's camps with what each plan
lacks. See `devdocs/CAMP_PLAN_SECTIONS.md`. The dashboard's "Plan the year and the camps" section
(`moment: 'plan'`, after "This week") gathers the long-range and camp tiles.
