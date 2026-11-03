ALTER TABLE decision_operations ADD COLUMN IF NOT EXISTS operation_type text NOT NULL DEFAULT 'review';
ALTER TABLE decision_operations ADD COLUMN IF NOT EXISTS invoice_id text;
ALTER TABLE decision_operations ADD COLUMN IF NOT EXISTS generation bigint;
ALTER TABLE decision_operations ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE decision_operations ADD COLUMN IF NOT EXISTS request jsonb;
ALTER TABLE decision_operations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'committed';
CREATE INDEX IF NOT EXISTS decision_operations_invoice ON decision_operations(invoice_id,created_at);
