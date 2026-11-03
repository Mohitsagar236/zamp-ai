#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <backup-directory> <new-isolated-project-name> <new-env-file>" >&2
  exit 2
fi
backup=$1 project=$2 env_file=$3
[[ -d "$backup/documents" && -f "$backup/workflow.dump" && -f "$backup/extraction.dump" && -f "$backup/decision.dump" && -f "$backup/identity.dump" ]] || { echo "Backup is incomplete" >&2; exit 2; }
backup=$(cd "$backup" && pwd)
[[ -f "$backup/documents.sha256" && -f "$backup/manifest.txt" ]] || { echo "Backup integrity manifests are missing" >&2; exit 2; }
if [[ -s "$backup/documents.sha256" ]]; then (cd "$backup" && shasum -a 256 -c documents.sha256); fi
if [[ -f "$backup/databases.sha256" ]]; then (cd "$backup" && shasum -a 256 -c databases.sha256); fi
[[ "$project" == *restore* || "$project" == *validation* ]] || { echo "Use a distinct project name containing 'restore' or 'validation'" >&2; exit 2; }
[[ -f "$env_file" ]] || { echo "New isolated Compose env file not found" >&2; exit 2; }
source_project=$(sed -n 's/^compose_project=//p' "$backup/manifest.txt" | head -n 1)
source_port=$(sed -n 's/^app_port=//p' "$backup/manifest.txt" | head -n 1)
target_port=$(sed -n 's/^APP_PORT=//p' "$env_file" | tail -n 1)
[[ "$project" != "$source_project" ]] || { echo "Restore project must differ from the source project name" >&2; exit 1; }
if [[ -n "$source_port" && -n "$target_port" && "$source_port" == "$target_port" ]]; then
  echo "Restore APP_PORT must differ from source port $source_port" >&2
  exit 1
fi
command -v docker >/dev/null || { echo "Docker is required" >&2; exit 2; }
compose=(docker compose --project-name "$project" --env-file "$env_file")
for volume in "${project}_postgres" "${project}_documents"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "Refusing restore: isolated project volume $volume already exists. Choose a fresh project name." >&2
    exit 1
  fi
done

# Create only the new project's empty Postgres volume and databases. No existing
# application service or volume is stopped, modified, or used as a restore target.
"${compose[@]}" up -d postgres
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if "${compose[@]}" exec -T postgres psql -U invoicelens_admin -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname IN ('invoicelens_workflow','invoicelens_extraction','invoicelens_decision','invoicelens_identity')" 2>/dev/null | grep -qx '4'; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == "1" ]] || { echo "Isolated database initialization did not become ready" >&2; exit 1; }
for service in workflow extraction decision identity; do
  db="invoicelens_${service}"
  role="${service}_svc"
  password_var="$(printf '%s' "$service" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  "${compose[@]}" exec -T postgres sh -c "PGPASSWORD=\"\$$password_var\" exec pg_restore --exit-on-error -h 127.0.0.1 -U $role -d $db --no-owner --no-privileges" < "$backup/$service.dump"
done
# Revoke browser sessions after restoring account/password and identity audit data.
"${compose[@]}" exec -T postgres psql -U invoicelens_admin -d invoicelens_identity -c 'DELETE FROM session; DELETE FROM verification;'

# Build the target image, then use a one-off frontend container solely to copy
# private document bytes into this new project's named volume.
"${compose[@]}" build frontend
"${compose[@]}" run --rm --no-deps -v "$backup/documents:/restore:ro" -v "${project}_documents:/app/.data" frontend node --input-type=module -e 'import {cp,mkdir} from "node:fs/promises"; await mkdir("/app/.data/files",{recursive:true}); await cp("/restore","/app/.data/files",{recursive:true});'
"${compose[@]}" run --rm --no-deps -v "$backup:/restore:ro" -v "${project}_documents:/app/.data:ro" frontend node scripts/verify-restored-documents.mjs /restore/documents /app/.data/files

# Migrations and service startup happen only after DB and documents are restored.
if [[ "${INVOICELENS_RESTORE_START:-true}" == "false" ]]; then
  echo "Isolated restore prepared without application startup. Compare all database counts before starting workers with: ${compose[*]} up -d --build"
  exit 0
fi
"${compose[@]}" up -d --build
echo "Isolated restore started in Compose project '$project'. Run the checks in docs/operations.md § Isolated restore verification; this script does not declare the restore verified."
