-- What a parent accepted or refused on a permission slip (#1410).
-- When a parent signs or declines, the server freezes the text the slip presented (activity,
-- dates, description, authorization text, conditions) into answered_content, and writes the
-- SHA-256 of its canonical form into signature_hash (services/permissionSlipFingerprint.js).
-- Slips answered before this migration have no frozen content: whatever their signature_hash
-- holds, they are shown as not verifiable, never as verified. The frozen text lives in the slip's
-- own row, so erasing the slip erases it.
ALTER TABLE public.permission_slips
  ADD COLUMN IF NOT EXISTS answered_content JSONB;

COMMENT ON COLUMN public.permission_slips.answered_content IS
  'Text the parent was shown when answering, frozen by the server: {version, content}. signature_hash is the SHA-256 of its canonical JSON. NULL for a slip not yet answered, or answered before #1410 (not verifiable).';

COMMENT ON COLUMN public.permission_slips.signature_hash IS
  'SHA-256 (hex) of answered_content in canonical JSON, written by the server when a parent signs or declines. Proves which text was answered, not who answered. A value without answered_content predates #1410 and is never treated as verified.';
