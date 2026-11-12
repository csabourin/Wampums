# Shared activity tasks

`/tasks` lists the signed-in member's assignments (`tasks.view`); managers
(`tasks.manage` plus `tasks.view`) can switch to unit tasks and create or edit
assignments. These permissions grant no access to youth or health records. Units
explicitly grant them through the role matrix; the district role receives new
permissions through its existing trigger. Task-only helpers can use an ordinary
unit-scoped custom role with only `tasks.view`.

Managers can use Edit assignment in either task view to change the assignee of
an ordinary task. The editor starts on the assignee field.

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
The assignment form lists meetings and activities together by start date, excluding
events that ended before today. Editing a task keeps its linked event available.

## Email reminders

Assignees are emailed about their tasks without anything to configure (`services/taskReminders.js`,
migration `086_task_email_reminders.sql`, limits in `TASK_REMINDERS` of `config/tasks.js`):

- **On assignment.** `saveTaskInTransaction` queues an `assigned` row in `task_reminder_deliveries`
  in the task's own transaction whenever the assignee is new, so every writer of tasks (the task
  form, camp equipment lots) notifies the same way. Someone who assigns a task to themselves is not
  written to, and a notice not yet sent is dropped when the task is reassigned.
- **Two days before the due date, and on the day**, from 7:00 in the reminders' time zone
  (`EQUIPMENT_REMINDER_TIME_ZONE`). A task assigned today is not also reminded today.

One poll a minute, serialized across instances by an advisory lock, sends each person **one email**
grouping everything a unit owes them at that moment, in their language (English for a missing text).
The email lists task titles, event names and due dates, then links to `/tasks`; the link changes
nothing. Each reason is claimed in `task_reminder_deliveries` and committed before transport: a crash
(`sending`) or an uncertain provider outcome (`uncertain`) is never replayed. A new assignee or a new
due date is a new reminder.

No email goes to a finished task, a cancelled or removed event, an inactive member, a missing
address or someone without `tasks.view`. A task with a material reminder
(`devdocs/EQUIPMENT_REMINDERS.md`) keeps its assignment notice but leaves due reminders to it.

A unit turns all of this off with the switch above its unit tasks (`GET`/`PUT
/api/v1/tasks/reminder-settings`, `tasks.manage`, refused to demo accounts), stored as the
`task_email_reminders` setting `{ enabled }`; absent means on. Notices queued while it is off are
skipped, not sent later. Tests use fictional accounts and a mocked mail provider.
