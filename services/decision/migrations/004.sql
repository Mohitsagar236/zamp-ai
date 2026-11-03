ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_kind_check;
ALTER TABLE commitments ADD CONSTRAINT commitments_kind_check
  CHECK (kind IN ('reservation','approval','opening'));
CREATE TABLE reference_import_previews (
  preview_id text PRIMARY KEY,
  fingerprint text NOT NULL,
  actor_id text NOT NULL,
  result jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE reference_import_operations (
  import_id text PRIMARY KEY,
  fingerprint text NOT NULL,
  actor_id text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reference_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  action text NOT NULL,
  subject text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX reference_audit_time_idx ON reference_audit(at DESC);
