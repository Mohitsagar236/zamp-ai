#!/bin/bash
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=workflow_password="$WORKFLOW_DB_PASSWORD" \
  --set=extraction_password="$EXTRACTION_DB_PASSWORD" \
  --set=decision_password="$DECISION_DB_PASSWORD" \
  --set=identity_db_password="$IDENTITY_DB_PASSWORD" <<'SQL'
CREATE ROLE workflow_svc LOGIN PASSWORD :'workflow_password';
CREATE DATABASE invoicelens_workflow OWNER workflow_svc;
CREATE ROLE extraction_svc LOGIN PASSWORD :'extraction_password';
CREATE DATABASE invoicelens_extraction OWNER extraction_svc;
CREATE ROLE decision_svc LOGIN PASSWORD :'decision_password';
CREATE DATABASE invoicelens_decision OWNER decision_svc;
CREATE ROLE identity_svc LOGIN PASSWORD :'identity_db_password';
CREATE DATABASE invoicelens_identity OWNER identity_svc;
SQL
