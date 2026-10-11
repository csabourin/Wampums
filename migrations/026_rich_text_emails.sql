-- Basic formatting in emailed texts.
--
-- An announcement's message and an activity's description (sent in the
-- permission-slip email) can now carry bold, italic, lists and links. The
-- formatted version is kept beside the plain one, which stays the text the
-- other channels and the mobile app read: push notifications, WhatsApp,
-- Google Chat, calendar files. The server derives the plain text from the
-- formatted one whenever both are saved; a write that sends only plain text
-- clears the formatted version, so the two never disagree.

ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS message_html TEXT;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS description_html TEXT;
ALTER TABLE public.permission_slips ADD COLUMN IF NOT EXISTS activity_description_html TEXT;

COMMENT ON COLUMN public.announcements.message_html IS
  'Formatted message (p, br, strong, em, ul, ol, li, a[href]), sanitized by utils/richText.js; NULL for plain-text messages. message holds its plain text.';
COMMENT ON COLUMN public.activities.description_html IS
  'Formatted description (p, br, strong, em, ul, ol, li, a[href]), sanitized by utils/richText.js; NULL for plain-text descriptions. description holds its plain text.';
COMMENT ON COLUMN public.permission_slips.activity_description_html IS
  'Formatted copy of the activity description, sent in the permission-slip email; NULL when the description is plain text.';
