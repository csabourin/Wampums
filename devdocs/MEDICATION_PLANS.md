# Correcting a medication plan (#1379)

A family corrects its child's medication plan **in place**: same plan, same child, with a record of
what changed. These rules are binding; tests: `test/routes-medication.test.js` (PUT block),
`test/medication-plan-corrections.integration.test.js`, `test/spa/MedicationPlanCorrection.test.js`.

## Who may correct a plan

- Only an adult **linked to the plan's child** (`user_participants`), through
  `MEDICATION_PLAN_EDIT_POLICY` (`middleware/medicationAuthorizationPolicy.js`). Holding
  `medication.manage` is not enough: the team administers a plan, it does not rewrite it. A team
  member who is also the child's parent corrects it as the parent.
- The reception screen (`MedicationReception.js`) records what was handed in; it has no plan editing.
- The SPA offers "Edit" on a child's own page (`/medication-planning/:id`) to an account holding a
  family role. The server decides.

## What a correction does — `PUT /api/v1/medication/requirements/:id`

- Keeps the plan's id and child. A body naming another child answers 409
  `medication_participant_immutable`; another child gets a plan of its own.
- Names the version it started from (`expected_updated_at`, the plan's `updated_at` as listed). The
  row is locked (`FOR UPDATE`); a plan changed since answers 409 `medication_requirement_changed`,
  and the screen reloads it and says so instead of overwriting.
- A correction that changes nothing writes nothing (`revision: null`).
- Records each correction in `medication_requirement_revisions` (migration 080): the changed fields
  `{ field: { from, to } }`, who, when, and whether it asked for a new signature. Same transaction
  as the correction. `GET /v1/medication/requirements` lists them with each plan (`revisions`).
- Answers `{ requirement, revision }`. Needs the network: it is never queued offline.

## What changes what is given

Name, dose amount and unit, dosage instructions, schedule (type, times, meal slots, interval) and
route (`SUBSTANTIVE_FIELDS` in `services/medicationPlanRevisions.js`). Notes and treatment dates do not.

When one of them changes:

- **Doses already given, missed or cancelled never change.** Each dose keeps the dose recorded when
  it was scheduled.
- Doses still `scheduled` later follow a corrected dose amount or unit, unless the team set that
  dose apart from the plan.
- A dose still scheduled at a time the corrected plan no longer has is **not** cancelled: the
  upcoming list marks it "Time removed from the plan" (computed on the device, in its time zone; the
  server has no unit time zone) and the team decides.
- The SPA shows "before → after" for these fields and asks to confirm before sending.

## Signatures

- An administration authorization covering the plan, **signed by another adult** than the one
  correcting, becomes `plan_changed`. It is then listed with those to sign again
  (`GET /v1/medication/authorizations/pending-signature`, the family's to-do list), and the
  authorization form says so as an alert.
- The signer correcting their own plan is not asked to sign twice.
- `plan_changed` is not undone by a scout-year rollback, which restores only `expired`.
