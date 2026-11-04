# Shared activity tasks

`/tasks` lists the signed-in member's assignments (`tasks.view`); managers
(`tasks.manage` plus `tasks.view`) can switch to unit tasks and create or edit
assignments. These permissions grant no access to youth or health records. Units
explicitly grant them through the role matrix; the district role receives new
permissions through its existing trigger. Task-only helpers can use an ordinary
unit-scoped custom role with only `tasks.view`.

Migration `052_activity_tasks.sql` creates tasks linked to exactly one outing/camp
or planned meeting. Use `services/activityTasks.js` for writes: it locks and checks
active membership in the same unit, verifies the event's unit, and commits task
creation/status history atomically. Status changes require `expected_status` and
return 409 for stale edits. A reassigned task disappears from the previous member's
list. The personal status endpoint always filters by the authenticated assignee;
management endpoints require `tasks.manage`. History records who changed the
status and when. Extend `config/tasks.js` and `CONFIG.TASKS.STATUS_KEYS` together
when adding states, with English and French labels and a migration extending the
status constraint.

Regenerating a year plan preserves meetings with assigned tasks. Deleting a plan
detaches those meetings, preserving assignments and their history.

Ordinary task writes require a connection and cannot be queued. Equipment-lot duties
are edited through their lot and use its preparation and receipt rules below. Confirmed writes invalidate
task reads through the shared API client. The task screen uses minimal event/member
choices rather than requesting participants, families, contacts or health forms.
