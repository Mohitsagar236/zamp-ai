CREATE TABLE legacy_imports (
  source_invoice_id text PRIMARY KEY,
  imported_at timestamptz NOT NULL DEFAULT now()
);
