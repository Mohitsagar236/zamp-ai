CREATE TABLE IF NOT EXISTS request_buckets (
  principal_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (principal_id, window_start)
);
