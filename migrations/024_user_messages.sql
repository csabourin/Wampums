-- A copy of each pushed message for each person it was sent to.
--
-- A push notification only showed its text in the phone's notification
-- shade: tapping it opened the app on whatever page it was last on, and once
-- the notification was gone the message was lost. Each push now records one
-- row per recipient here, and the notification opens /messages/<id>, which
-- shows that row to that person only.
--
-- Rows from an announcement keep its id; a direct push from the notification
-- screen has none. Removing the person or the unit removes their messages;
-- removing the sender or the announcement keeps the text.

CREATE TABLE IF NOT EXISTS public.user_messages (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  announcement_id INTEGER REFERENCES public.announcements(id) ON DELETE SET NULL,
  sent_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_messages IS
  'One row per person a push message was sent to: its title and text as sent, so tapping the notification opens a page that shows it.';

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient
  ON public.user_messages (organization_id, user_id, created_at DESC);
