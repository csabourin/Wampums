-- Reminder metadata belongs to a shared task: never a second assignee or event.
CREATE SEQUENCE IF NOT EXISTS public.task_equipment_reminder_revision AS INTEGER;
CREATE TABLE IF NOT EXISTS public.task_equipment_reminders (
 task_id INTEGER PRIMARY KEY,
 organization_id INTEGER NOT NULL,
 materials TEXT NOT NULL CHECK (length(materials) BETWEEN 1 AND 5000),
 lead_days INTEGER NOT NULL CHECK (lead_days BETWEEN 0 AND 30),
 repeat_hours INTEGER NOT NULL CHECK (repeat_hours BETWEEN 24 AND 168),
 revision INTEGER NOT NULL DEFAULT nextval('public.task_equipment_reminder_revision'),
 confirmed_at TIMESTAMPTZ,
 last_attempt_at TIMESTAMPTZ,
 delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
 FOREIGN KEY (task_id, organization_id) REFERENCES public.activity_tasks(id, organization_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.task_equipment_reminders IS 'Opt-in material reminders on shared assignments. Durable pre-send claims prevent duplicate polling deliveries. Uncertain sends are never automatically retried.';

CREATE OR REPLACE FUNCTION public.reset_task_equipment_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD.title, OLD.assignee_id, OLD.due_date, OLD.activity_id, OLD.meeting_id)
    IS DISTINCT FROM ROW(NEW.title, NEW.assignee_id, NEW.due_date, NEW.activity_id, NEW.meeting_id) THEN
   UPDATE public.task_equipment_reminders SET revision = nextval('public.task_equipment_reminder_revision'), confirmed_at = NULL,
     last_attempt_at = NULL, delivery_status = 'pending'
    WHERE task_id = NEW.id AND organization_id = NEW.organization_id;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS task_equipment_confirmation_reset ON public.activity_tasks;
CREATE TRIGGER task_equipment_confirmation_reset AFTER UPDATE ON public.activity_tasks
 FOR EACH ROW EXECUTE FUNCTION public.reset_task_equipment_confirmation();
