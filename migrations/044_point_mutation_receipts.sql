-- Receipts and point awards commit atomically; never expire receipts while a
-- device can still retry an offline batch after a camp.
CREATE TABLE IF NOT EXISTS point_mutation_receipts (
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_key VARCHAR(128) NOT NULL,
  request_hash TEXT NOT NULL,
  response_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id, mutation_key)
);
