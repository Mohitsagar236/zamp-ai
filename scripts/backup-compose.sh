#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <compose-project> <env-file> <new-backup-directory>" >&2
  exit 2
fi
project=$1 env_file=$2 output=$3
[[ -f "$env_file" ]] || { echo "Compose env file not found" >&2; exit 2; }
[[ ! -e "$output" ]] || { echo "Backup destination must not already exist" >&2; exit 2; }
command -v docker >/dev/null || { echo "Docker is required" >&2; exit 2; }
compose=(docker compose --project-name "$project" --env-file "$env_file")
mkdir -m 700 -p "$output" "$output/documents"
writers_stopped=0
cleanup_on_exit() {
  result=$?
  if [[ $result -ne 0 ]]; then
    echo "Backup incomplete; preserve $output for diagnosis and do not use it for restore." >&2
    if [[ $writers_stopped -eq 1 ]]; then
      echo "Restarting the source application after the failed backup attempt." >&2
      "${compose[@]}" start extraction decision workflow frontend || echo "Could not restart every source service; inspect Compose status immediately." >&2
    fi
  fi
  exit "$result"
}
trap cleanup_on_exit EXIT

# Stop the worker first. Queued jobs are durable and resume after restore; a running
# lease means an operation may still be in flight, so refuse to snapshot.
writers_stopped=1
"${compose[@]}" stop -t 180 workflow
running=$("${compose[@]}" exec -T postgres psql -U invoicelens_admin -d invoicelens_workflow -Atqc "SELECT count(*) FROM workflow_jobs WHERE status='running'")
if [[ "$running" != "0" ]]; then
  echo "Refusing backup: $running Workflow job(s) still hold running leases. Wait for completion and retry." >&2
  exit 1
fi
"${compose[@]}" stop -t 60 frontend decision extraction

for service in workflow extraction decision identity; do
  db="invoicelens_${service}"
  role="${service}_svc"
  password_var="$(printf '%s' "$service" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  case "$service" in identity) role=identity_svc ;; esac
  "${compose[@]}" exec -T postgres sh -c "PGPASSWORD=\"\$$password_var\" exec pg_dump -h 127.0.0.1 -U $role -d $db -Fc" > "$output/$service.dump"
done
(cd "$output" && shasum -a 256 workflow.dump extraction.dump decision.dump identity.dump) > "$output/databases.sha256"
workflow_counts=$("${compose[@]}" exec -T postgres psql -U invoicelens_admin -d invoicelens_workflow -Atqc "SELECT (SELECT count(*) FROM invoices)||'|'||(SELECT count(*) FROM workflow_jobs)||'|'||(SELECT count(*) FROM stage_events)||'|'||(SELECT count(*) FROM reconciliation_cases)")
extraction_counts=$("${compose[@]}" exec -T postgres psql -U invoicelens_admin -d invoicelens_extraction -Atqc "SELECT (SELECT count(*) FROM extraction_cache)||'|'||(SELECT count(*) FROM extraction_results)||'|'||(SELECT count(*) FROM extraction_operations)")
decision_counts=$("${compose[@]}" exec -T postgres psql -U invoicelens_admin -d invoicelens_decision -Atqc "SELECT (SELECT count(*) FROM decision_records)||'|'||(SELECT count(*) FROM vendors)||'|'||(SELECT count(*) FROM purchase_orders)||'|'||(SELECT count(*) FROM commitments)||'|'||(SELECT count(*) FROM decision_operations)")
identity_counts=$("${compose[@]}" exec -T postgres psql -U invoicelens_admin -d invoicelens_identity -Atqc "SELECT (SELECT count(*) FROM \"user\")||'|'||(SELECT count(*) FROM identity_audit)")
commitments_by_po=$("${compose[@]}" exec -T postgres psql -U invoicelens_admin -d invoicelens_decision -AtF '|' -c "SELECT po_id,count(*),sum(amount_minor) FROM commitments GROUP BY po_id ORDER BY po_id")
container=$("${compose[@]}" ps --all -q workflow)
[[ -n "$container" ]] || { echo "Workflow container was not found; document volume could not be identified." >&2; exit 1; }
docker cp "$container:/app/.data/files/." "$output/documents/"
docker inspect --format '{{.Config.Image}}' "$container" > "$output/workflow-image.txt"
if [[ -n "$(find "$output/documents" -type f -print -quit)" ]]; then
  (cd "$output" && find documents -type f -print0 | sort -z | xargs -0 shasum -a 256) > "$output/documents.sha256"
else
  : > "$output/documents.sha256"
fi
app_port=$(sed -n 's/^APP_PORT=//p' "$env_file" | tail -n 1)
cat > "$output/manifest.txt" <<EOF
created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
compose_project=$project
app_port=${app_port:-3000}
workflow_image=$(cat "$output/workflow-image.txt")
queued_jobs_resume_on_restore=true
running_jobs_at_snapshot=0
identity_policy=users-password-credentials-and-audit-restored; all sessions revoked by restore script
secrets=not included; restore requires the same independently escrowed AUTH_SECRET and service credentials
workflow_counts=invoices|jobs|stage_events|reconciliation_cases:${workflow_counts}
extraction_counts=cache|results|operations:${extraction_counts}
decision_counts=records|vendors|purchase_orders|commitments|operations:${decision_counts}
identity_counts=users|audit:${identity_counts}
EOF
printf '%s\n' "$commitments_by_po" > "$output/commitments-by-po.txt"
chmod -R go-rwx "$output"
trap - EXIT
echo "Consistent application-writer-stopped backup created at $output. Keep the source Compose project stopped until backup files are reviewed, then restart it with: ${compose[*]} start extraction decision workflow frontend"
