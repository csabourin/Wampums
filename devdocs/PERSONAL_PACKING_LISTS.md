# Personal packing lists: staff draft, review and publish

Open the editor from the activity form's **Save and prepare the packing list**
action, or from an activity card. Single-day activities need no planner camp.
An activity already linked to a camp uses that camp's list and packing keys.

## Staff workflow

Management requires `personal_equipment.manage` and organization scope. Items are
grouped by category (`CATEGORIES` in `config/personal_equipment.json`, migration 067;
older items without one are placed by their suggestion key, else under Other). Each
item is one compact row: quantity, label and an options button (`aria-expanded`)
that reveals its category, an optional catalogue link, Move up / Move down within
its category (the keyboard alternative to dragging; focus stays on the button used)
and Remove. A list never saved opens on its season, stay and nights. "Paste a list
of items" sits next to "Add an item". The sidebar holds family instructions, the
writing language and translations: the other team language and the unit's optional
languages are checked by default, the rest wait under "Other languages", and the
writing language is never offered. Preview shows the family view, categories and
checkboxes included. Actions remain in a fixed bar, with bottom space and scroll
margins protecting content and keyboard focus.

Bulk entry previews its line count, adds editable items, recognises leading whole
quantities, preserves stable keys and focuses the first addition. Saving or
changing the editor cannot silently discard text waiting in the bulk area.
Adding seasonal suggestions retains customized items and only adds missing keys;
replacing the entire list is a separate confirmed action. Invalid rows are named
and focused. Navigation and tab/window closure protect unsaved content.

**Save draft**, **Preview list** and **Publish to families** are distinct actions.
Publishing requires an explicit review confirmation. `packing_list_publications`
stores the last common content and translations explicitly published; it contains
no child identity or packing progress. Saving a new draft leaves that publication
unchanged. Cancellation/eligibility checks still apply before any family read.
Migration 065 backfills publications for existing published camp/activity lists.
Migration 066 records `published_at`. The editor's status line says whether families
have never received the list, have the current version, or still see the version
published on a given date while changes wait ("Publish changes").

## AI is staff-only throughout the application

Every provider endpoint requires `ai.use`, organization scope and the feature's
own rights. Linked-family roles cannot be granted AI use through role management.
District automatically receives the new permission and the roles matrix shows its
bilingual name and why family roles cannot use it. Migration 065 also grants
packing-list preparation rights to organization-scoped roles managing meetings or
editing activities. No checks depend on a user's role name.

All AI controls use `AIUtils.aiActionLabel`: a visible IA/AI badge and the full
technology name in the native accessible button label. This applies to activity
and meeting generation, message rewriting/translation, receipt reading, equipment
suggestions and packing translation. Loading/restoring a button retains that
markup. Parent screens never show an AI action.

Staff select languages and press one explicit AI-labelled action. Only common
item keys, labels and instructions reach the provider. Calls reuse existing budget
limits and versioned translation caches. Progress names the language; individual
failures remain visible and can be retried without regenerating completed versions.
Prepared versions can be reviewed and corrected manually with a version-checked
PUT requiring management rights (no AI permission or provider call needed).
Generating or correcting a translation marks the source list as a draft. Families
do not see these changes until staff explicitly publish again.

Text changes invalidate only what they touch (`carryTranslation` in
`services/packingPublications.js`): an item whose labels did not change keeps its
translated or hand-corrected label in the next version, and changed or new items and
changed instructions are left to translate. Such a translation is stored with
`partial: true`; translating it again sends the AI only the missing text, and
French or English take what the team wrote. A partial translation is never
published to families nor offered for hand correction. Stable keys and local checks survive
translation, publication and ordinary edits. Families choose only authored or
prepared languages included in their publication. No generation request and no
old device-side translation cache can provide unpublished text.

## Device-only packing progress

Families see the instructions first, then each child's progress ("7 of 18 packed",
with a `<progress>` bar), items grouped by category, and "Hide packed items" (a
per-device preference; a ticked item leaves the list only once focus moves on).
A tick announces nothing unless the browser refuses to keep it, in one shared status.

`packingStorage.js` stores item keys in localStorage, scoped by account, unit,
selected year, camp/activity and child. Standalone activity ids use an `activity-`
prefix. A checkbox makes no server request and works offline after opening the
published list on that device. Another device has separate checks. Blocked or
full storage restores the previous visible state and explains the failure.

Writes and AI calls are online-only and never enter an offline outbox. Tests use
fictional families and mocked providers. Integration tests cover publication
isolation, stale versions, family denial and human corrections without AI calls.
Browser tests cover both layouts, bulk entry, local progress and AI identification.
