-- Archive sent messages and news.
--
-- The history of sent messages and the news grow without end and crowd the
-- screens that show them. Archiving hides an item from the default view of
-- the "Messages and news" screen without deleting it: the delivery log of a
-- sent message stays for the record, and an archived item can be restored.
-- An archived news item is also no longer shown on the public news feed.

ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.news ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.announcements.archived_at IS
  'When the message was archived out of the history; NULL while it is listed. Only finished messages (sent, partial, failed, draft) can be archived.';
COMMENT ON COLUMN public.news.archived_at IS
  'When the news item was archived; NULL while it is listed. Archived items are left out of the feed.';

CREATE INDEX IF NOT EXISTS idx_announcements_org_archived
  ON public.announcements (organization_id, archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_org_archived
  ON public.news (organization_id, archived_at, created_at DESC);
