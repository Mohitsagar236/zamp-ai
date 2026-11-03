CREATE TABLE invoices(id text PRIMARY KEY,filename text NOT NULL,hash text NOT NULL,storage_key text NOT NULL UNIQUE,status text NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,state jsonb NOT NULL,generation bigint NOT NULL DEFAULT 1,upload_key text UNIQUE,upload_fingerprint text NOT NULL);
CREATE INDEX invoices_created ON invoices(created_at DESC);
CREATE TABLE workflow_jobs(id uuid PRIMARY KEY,invoice_id text NOT NULL REFERENCES invoices(id),generation bigint NOT NULL,kind text NOT NULL DEFAULT 'process',payload jsonb NOT NULL DEFAULT '{}',status text NOT NULL,attempts int NOT NULL DEFAULT 0,lease_until timestamptz,lease_token uuid,error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(invoice_id,generation));
CREATE INDEX workflow_jobs_claim ON workflow_jobs(status,created_at);
CREATE TABLE stage_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,invoice_id text NOT NULL REFERENCES invoices(id),at timestamptz NOT NULL DEFAULT now(),type text NOT NULL,data jsonb NOT NULL,correlation_id text NOT NULL);
CREATE INDEX stage_events_invoice ON stage_events(invoice_id,id);
CREATE TABLE workflow_heartbeat(id text PRIMARY KEY,at timestamptz NOT NULL);
