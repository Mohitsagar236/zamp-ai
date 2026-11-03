#!/usr/bin/env bash
set -euo pipefail
out=${1:-.env.microservices}
[[ ! -e "$out" ]] || { echo "Refusing to overwrite $out" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
while IFS= read -r line || [[ -n "$line" ]]; do
  key=${line%%=*}
  case "$key" in
    POSTGRES_ADMIN_PASSWORD|WORKFLOW_DB_PASSWORD|EXTRACTION_DB_PASSWORD|DECISION_DB_PASSWORD|IDENTITY_DB_PASSWORD|WORKFLOW_TOKEN|WORKFLOW_IDENTITY_SECRET|EXTRACTION_TOKEN|DECISION_TOKEN|AUTH_SECRET)
      printf '%s=%s\n' "$key" "$(openssl rand -hex 32)" >> "$tmp" ;;
    *) printf '%s\n' "$line" >> "$tmp" ;;
  esac
done < .env.microservices.example
chmod 600 "$tmp"
mv "$tmp" "$out"
trap - EXIT
echo "Wrote unique credentials to $out with mode 600. Keep this file private and back up required runtime secrets separately."
