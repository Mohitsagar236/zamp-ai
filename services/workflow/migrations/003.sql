ALTER TABLE workflow_jobs
  ADD COLUMN correlation_id text NOT NULL DEFAULT 'legacy';
