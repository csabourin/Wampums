# Camp equipment lots — server foundation (#1247)

This draft introduces the transactional server model. It does **not** deliver a usable
camp-lot screen or offline camp preparation yet. Keep #1247 open until those parts
and their mobile-browser accessibility tests are delivered.

## Model and permissions

A lot belongs to one unit and one planned meeting of kind `camp`. Its articles are
selected from that camp's collective material list. Labels and units are trusted
server snapshots; client-supplied labels cannot replace them. Allocations across
lots cannot exceed the current list quantities when a lot is saved. Changing the
schedule afterwards can change the needs; the future editor must surface that
mismatch rather than silently discard allocations. Lots do not reserve inventory.

Every lot has one `prepare` assignee; `transport` and `return` are optional. If those
are absent, the preparer performs the corresponding transition. Each duty links to
an ordinary shared task, which remains the sole source of assignee, due date and
progress. Only active unit members can be assigned. Preparation/transport tasks use
the first camp day and return tasks use the last. Generic task writes reject linked
tasks with `camp_lot_task_managed` (409); update the lot instead. Generic task reads
include `equipment_lot_id` and `equipment_lot_role` for future navigation.

Migration `059_camp_equipment_lots.sql` creates `camp_lots.view` and
`camp_lots.manage`. As with shared tasks, administrators explicitly grant the
permissions; the existing district permission trigger retains its normal behavior.
Managing lots additionally requires `tasks.manage`; personal access requires
`tasks.view`. Demo accounts cannot mutate lots. Unit identity always comes from
the authenticated request, and cross-unit resources return 404.

## API

All routes are below `/api/v1/camp-equipment-lots` and require authentication.

| Method and path | Permission | Result |
| --- | --- | --- |
| GET `/meetings/:meetingId` | `camp_lots.view` | Lots, items, duty tasks and state history |
| GET `/meetings/:meetingId/options` | `camp_lots.manage` + `tasks.manage` | Camp list, allocated quantities and active member id/name choices |
| POST `/meetings/:meetingId` | Both manage permissions | Create a lot and its tasks atomically |
| PUT `/meetings/:meetingId/:id` | Both manage permissions | Replace a preparation lot's name, items and assignments |
| GET `/mine` | `tasks.view` | Only lots with a task assigned to the caller |
| PATCH `/mine/:id/status` | `tasks.view` + duty ownership | Load or return an assigned lot |
| PATCH `/:id/status` | Both manage permissions | Move a unit lot to an adjacent state |

Create body: `name` (1–150 characters), a UUID v4 `creation_key`, nonempty `items`
(using the shared material-item format `{catalog_item_id, quantity}` or
`{equipment_item_id, quantity}`), and unique `roles` such as
`[{role: "prepare", user_id: "<active member UUID>"}]`.

Replace uses the same content and a positive integer `expected_version`; a
`creation_key` is not required. Content is editable only in `to_prepare`.
Status changes require `status`, `expected_version` and a UUID v4 `mutation_id`.
Allowed transitions are `to_prepare ↔ loaded ↔ returned`. Personal writes cannot
reset to `to_prepare`; a manager can correct a mistake. Loading completes prepare
and transport tasks; returning completes all tasks. Reopening derives the matching
task states in the same transaction. Cancelled camps reject all writes.

## Concurrency and retry behavior

Camp rows are locked before lot/task rows. This serializes allocations and keeps
all lot, task and history writes atomic. Stale versions and invalid transitions
return 409 without partial changes. A lost create response can be retried with the
same creation key and identical content; changed content with that key returns
409. Status receipts are scoped to unit, actor and mutation id. Repeating the same
mutation returns its original response without repeating history or task changes;
reusing its key for different content returns 409. Current ownership is checked
before a personal receipt is returned. After replay, clients must refresh to get
the current version, since another device may have changed it in the meantime.

These receipts are server primitives for future retry support. They do not make
camp lots available offline: no camp-package extension or outbox operation is
included in this draft.

## Remaining work before #1247 is complete

- Camp editor and personal task navigation in `spa/modules/`, with translated
  labels, clear progress, errors and loading/empty states.
- Prepared-camp package and outbox integration with explicit refusal for camps
  that were not prepared. Revalidate membership, ownership and versions on replay.
- Accessible phone interaction, jsdom/axe and real browser coverage at 390 px,
  including reconnect conflicts, duplicate delivery and assignment changes.
- Review deletion/archiving and retention needs before exposing content management.

Tests: `test/routes-camp-equipment-lots.test.js` covers validation, authentication,
permissions and demo refusals. `test/camp-equipment-lots.integration.test.js` covers
real PostgreSQL isolation, assignment, quantities, concurrency, replay and rollback;
it requires the fully migrated disposable `TEST_DATABASE_URL` used by CI.
