-- Automatic emails about assigned tasks: a notice on assignment, then reminders before the due date.
-- One row per email reason. A row claimed before transport is never sent twice.
CREATE TABLE IF NOT EXISTS public.task_reminder_deliveries (
 id SERIAL PRIMARY KEY,
 organization_id INTEGER NOT NULL,
 task_id INTEGER NOT NULL,
 assignee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('assigned', 'due_soon', 'due_today')),
 due_date DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 attempted_at TIMESTAMPTZ,
 FOREIGN KEY (task_id, organization_id) REFERENCES public.activity_tasks(id, organization_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.task_reminder_deliveries IS 'Emails about assigned tasks. An assigned row is queued with the assignment (skipped when someone assigns a task to themselves); due_soon and due_today rows are claimed by the dispatcher before transport. A new assignee or due date is a new reminder. Sending and uncertain rows are never replayed.';

-- A due reminder is sent once per task, assignee and due date. A task may be assigned to the same person again.
CREATE UNIQUE INDEX IF NOT EXISTS task_reminder_deliveries_due_once
 ON public.task_reminder_deliveries (task_id, assignee_id, kind, due_date) WHERE kind <> 'assigned';
CREATE INDEX IF NOT EXISTS task_reminder_deliveries_pending
 ON public.task_reminder_deliveries (organization_id, assignee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS task_reminder_deliveries_task ON public.task_reminder_deliveries (task_id, organization_id);
