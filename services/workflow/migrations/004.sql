CREATE TABLE reconciliation_cases (
  case_key text PRIMARY KEY,
  invoice_id text NOT NULL,
  operation_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('open','resolved')),
  explanation text NOT NULL,
  details jsonb NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);
CREATE INDEX reconciliation_cases_status ON reconciliation_cases(status,last_seen DESC);
