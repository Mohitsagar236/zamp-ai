CREATE TABLE vendors(id text PRIMARY KEY,name text NOT NULL,identifier text NOT NULL UNIQUE,aliases jsonb NOT NULL,approved boolean NOT NULL);
CREATE TABLE purchase_orders(id text PRIMARY KEY,vendor_id text NOT NULL REFERENCES vendors(id),currency text NOT NULL,status text NOT NULL,limit_minor bigint NOT NULL CHECK(limit_minor>=0),description text NOT NULL);
CREATE TABLE decision_records(invoice_id text PRIMARY KEY,content_hash text NOT NULL,created_at timestamptz NOT NULL,generation bigint NOT NULL DEFAULT 0,fields jsonb,selected_po text,review text NOT NULL DEFAULT 'pending' CHECK(review IN('pending','approved','rejected')),evaluation jsonb,updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX decision_records_hash ON decision_records(content_hash,created_at);
CREATE TABLE business_claims(business_key text PRIMARY KEY,invoice_id text NOT NULL UNIQUE REFERENCES decision_records(invoice_id),created_at timestamptz NOT NULL);
CREATE TABLE commitments(invoice_id text PRIMARY KEY REFERENCES decision_records(invoice_id),po_id text NOT NULL REFERENCES purchase_orders(id),vendor_id text NOT NULL,business_key text NOT NULL UNIQUE,amount_minor bigint NOT NULL CHECK(amount_minor>=0),label text NOT NULL,kind text NOT NULL CHECK(kind IN('reservation','approval')));
CREATE INDEX commitments_po ON commitments(po_id);
CREATE TABLE decision_operations(idempotency_key text PRIMARY KEY,request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
