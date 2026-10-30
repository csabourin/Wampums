# Material reminders (#1248)

A task is the only source of the responsible active account, event and due date.
The reminder is part of the task form (**Assign a task** or **Edit** in Unit tasks): tick
**Schedule a material reminder**, list the material (one article per line; it starts from the task
title), and choose the first reminder ("The day before", "3 days before", …; the default is two days)
and the follow-up delay ("Every day" … "Every week", 24–168 hours) from named presets. A stored value
outside the presets stays selectable. The task is saved first; if its reminder then fails, the form says
the task is saved and Save retries only the reminder, never creating a second task.
Camp-lot duties, which have no task form here, keep a reminder button in Unit tasks; no parallel task
or assignee is created. Only members who can manage tasks see that an assignee cannot be reached.

Tasks are listed by due date (Overdue, This week, Later), with finished tasks folded under Done.
Status changes are one-tap buttons (Start, Mark as done, Reopen).

The assignee opens their task from the email and presses **Confirmed — I will bring it**.
A GET never confirms anything. Confirmation stops reminders independently of task progress.
Changes to title, recipient, event, due date or reminder configuration invalidate the old confirmation.
Stale configuration and confirmation requests return 409; deleting and recreating a reminder cannot
reuse an earlier confirmation revision.

Inactive members, cancelled events, completed tasks, missing addresses and people without `tasks.view`
receive no email. The unit task list shows inactive/missing-email/no-task-access assignments.
Configuration requires `tasks.manage`; confirmation requires `tasks.view` and current ownership.
Demo writes are refused. These permissions grant no youth or health access.

Migration `061_task_equipment_reminders.sql` is re-runnable. The application service manager polls
opt-in reminders once per minute. A PostgreSQL session advisory lock serializes dispatcher instances;
a pre-transport durable claim survives crashes. Each follow-up respects its minimum repeat interval.
Transport acceptance is labelled as acceptance, not delivery. Missing transport reports failure.
A sending claim left by a crash or an uncertain transport outcome stops automatic follow-ups: inspect
provider receipts before deliberately reconfiguring. It is never silently replayed.

Unit sender identity and domain resolution reuse the normal email helpers. Tests use fictional
accounts and a mocked mail provider; no live email is sent by tests.
