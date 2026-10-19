-- Live-sync change counters, shared by every server instance.
--
-- A phone closes a backgrounded app's socket, so the app reconnects each time
-- it is brought back. To tell whether anything changed while it was away, the
-- server counts each unit's changes and sends the count on connection; when it
-- matches what the session last saw, the session keeps its cache and the
-- screen on display. Several instances serve the app at once (autoscale), so
-- the counts live here rather than in one instance's memory.
--
-- Row 0 counts writes no unit could be named for (public pages, webhooks):
-- every unit compares it too. No foreign key: row 0 names no unit, and a
-- deleted unit's row is harmless.

CREATE TABLE IF NOT EXISTS public.live_sync_versions (
  organization_id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.live_sync_versions IS
  'Live-sync change counters: one row per unit, plus row 0 for writes no unit could be named for. A reconnecting session compares them with what it last saw to decide whether to refresh its cache.';
COMMENT ON COLUMN public.live_sync_versions.organization_id IS
  'Unit whose changes are counted; 0 counts writes no unit could be named for (public pages, webhooks).';
COMMENT ON COLUMN public.live_sync_versions.version IS
  'Number of changes counted so far; only ever increases.';
