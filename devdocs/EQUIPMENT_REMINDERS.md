# Material reminders (#1248)

A task is the only source of the responsible active account, event and due date.
Create or open an assignment in **My tasks / Unit tasks**, then choose **Schedule a material reminder**.
The material text accepts one article per line. Configure how many days before the task's due date
(the default is two), and the minimum interval between follow-ups (24–168 hours).
Existing camp-lot duties may also have reminders; no parallel task or assignee is created.

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
