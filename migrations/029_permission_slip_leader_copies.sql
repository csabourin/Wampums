-- Leaders' copies of permission slip emails.
--
-- When a unit emails an activity's permission slips to the families, its
-- leaders receive the same request for information, without a signing link:
-- only a child's own family answers its slip, leaders included. A leader who
-- is the parent of an invited child and received the parent's email needs no
-- copy: that delivery is recorded here as their row.
--
-- The screen sends a large activity's slips in several requests at once, so
-- each leader's copy is claimed here before it is sent: the unique key lets
-- exactly one request send it. A later send for the same activity (children
-- added afterwards) sends no second copy.
--
-- group_key names what the slips were for: 'activity:<id>', or, for older
-- slips with no activity, 'meeting:<date>:<title>'.

CREATE TABLE IF NOT EXISTS public.permission_slip_leader_copies (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT permission_slip_leader_copies_unique UNIQUE (organization_id, group_key, user_id)
);

COMMENT ON TABLE public.permission_slip_leader_copies IS
  'One row per leader who has an activity''s permission slip request: a copy sent for information, or the family email itself when they are an invited child''s parent. Claimed before sending, so parallel sends mail each leader once.';
COMMENT ON COLUMN public.permission_slip_leader_copies.group_key IS
  'What the slips were for: activity:<id>, or meeting:<date>:<title> for slips with no activity.';
