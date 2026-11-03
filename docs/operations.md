# Operations and recovery (pilot preparation)

These procedures include executable Compose backup and isolated-restore scripts, but neither Docker runtime nor restore has been verified on this host. Do not use real invoices until the remaining items in [the remediation tracker](remediation-tracker.md) are closed.

## Configuration and startup

The gateway uses Better Auth individual accounts with administrator, reviewer and viewer roles. Production Compose requires `AUTH_MODE=individual`, the identity database, an independent `AUTH_SECRET`, and a Workflow identity signing secret. Review, document, reference import and account administration checks run server-side. Passwords and user records are stored in the identity database. Existing history without an actor ID stays explicitly unidentified; it is not assigned to a new user. Initial administrator creation is a one-time, empty-identity-database operation. Use individual accounts after bootstrap and revoke all sessions after a restore.

To prepare an untracked Compose environment file without printing generated credentials, run `npm run compose:env -- .env.microservices`. Inspect and adjust only non-secret settings such as `APP_URL` and `APP_PORT`; keep the file private. Start the isolated stack with:

```sh
docker compose --project-name invoicelens-validation --env-file .env.microservices up -d --build
docker compose --project-name invoicelens-validation --env-file .env.microservices ps
```

The example sets `DECISION_APP_ENV=production`, so the demo seed job exits without adding sample financial references. Create the first administrator after `identity-migrate` has completed. Read the bootstrap password without echoing it, then pass it only to the one-off container process (do not put it in shell history):

```sh
read -r -s -p 'Initial administrator password: ' ADMIN_BOOTSTRAP_PASSWORD; echo
export AUTH_BOOTSTRAP_PASSWORD
docker compose --project-name invoicelens-validation --env-file .env.microservices run --rm --no-deps -e AUTH_BOOTSTRAP=true -e AUTH_BOOTSTRAP_PASSWORD frontend npm run auth:bootstrap -- admin@example.invalid 'InvoiceLens Administrator'
unset ADMIN_BOOTSTRAP_PASSWORD
unset AUTH_BOOTSTRAP_PASSWORD
```

Replace the example email with the intended operator address. Then verify `docker compose ... ps` reports every service healthy, open `http://127.0.0.1:3000`, sign in, and upload a synthetic test PDF. Compose binds to loopback; a hosted install still needs reviewed TLS ingress, firewall/network policy, durable encrypted volumes, monitored disk capacity and secrets management. Do not expose it publicly from this example configuration.

Run migrations before service startup. Each service serializes its migration sequence with a PostgreSQL transaction advisory lock; migrations are atomic within that database, not across the three databases. Rehearse migrations and version compatibility on a clone. Keep a verified backup and the prior images before upgrading; a database downgrade is not implemented. If a migration fails, stop the rollout, diagnose it, and restore a verified consistent backup into an isolated environment; never run a destructive rollback against the only copy.

## Health and monitoring

Probe each `/health/live` for process liveness and the authenticated Workflow `/health/ready` (or gateway `/api/health`) for readiness. Workflow now returns 503 if its worker heartbeat is stale; an active worker renews the heartbeat during long jobs. OCR readiness reports configuration, not a language-model or document-accuracy test. Compose's individual service probes use liveness, so operators must also monitor readiness, queue age, failed jobs, retry counts, Decision/Extraction errors and disk/database capacity. Correlation IDs appear in service logs and review history. Configure centralized access-controlled logs, metrics, alerts, on-call ownership and retention before a pilot; none are provisioned by this repository.

## Consistent backup and isolated restore procedure

1. Schedule downtime and stop the frontend and all three application services so uploads, jobs and financial writes cannot change. Keep PostgreSQL running. Confirm no migrations, imports or background writers remain. A snapshot of only one database or a live file copy is not a consistent backup of the complete system.
2. Back up `invoicelens_workflow`, `invoicelens_extraction`, `invoicelens_decision` and `invoicelens_identity`, and copy the complete Workflow documents volume. Capture the exact image versions, migration versions, non-secret configuration and a manifest of document SHA-256 hashes. Store the backup encrypted with access controls and a documented retention period. Do not include credentials in command lines or backup logs.
3. Restore **only into a new isolated Compose project or server with empty volumes and different ports and credentials**. Initialize its four databases/roles, restore each dump to its matching database with compatible `pg_restore`, and restore documents to its new Workflow volume, preserving private ownership and permissions. Never point a restore command at the original workspace.
4. Start only the isolated restored stack. Compare database counts, migration versions, invoice histories, Decision commitments, representative PO balances and the full document hash manifest. Open representative PDFs, run a new synthetic invoice and verify no duplicate commitments. Record recovery time and discrepancies. Restore the original services separately after backup; keep the original backup until the drill passes.

The scripts coordinate the data stores and stop application writers. For a new backup destination run `npm run backup:compose -- invoicelens-validation .env.microservices ./backups/2026-11-01-001`. The script stops Workflow first, refuses to continue if any job still has a running lease, stops the other writers, dumps Workflow, Extraction, Decision and identity databases using `pg_dump` inside the `postgres` container, copies private documents from the Workflow volume, and writes document hashes, database row-count snapshots and PO commitment totals. Queued jobs are preserved as durable work and resume after restore; no running job is accepted at the snapshot point. On success, restart the source with the command printed by the script. A failed attempt restarts the source services automatically; inspect their health before retrying.

Restore only to a fresh project and a separate environment file with different ports and credentials, while retaining the same account password hashes and independently escrowed `AUTH_SECRET` policy. For example: `npm run restore:compose -- ./backups/2026-11-01-001 invoicelens-validation-restore .env.restore`. The script refuses existing Postgres or document volumes, restores each database and document tree into the new named volumes, deletes restored browser sessions and verification tokens while preserving users, password credentials and identity audit, then starts the isolated stack. It does not mark the restore verified. Complete the checks below and record counts, hashes, representative records, warnings and elapsed recovery time before relying on backup recovery. The script's expected-volume check is a second safety barrier; independently inspect the Compose project name and volume names before running it.

### Isolated restore verification

1. Confirm every restored service is healthy and check the three DB migration tables plus `invoicelens_identity_migrations`.
2. Compare invoice counts, event/history counts, reference/commitment counts and identity user/audit counts against the backup source manifest and recorded pre-backup values. Verify the restored `session` and `verification` tables are empty.
3. Run `(cd ./backups/2026-11-01-001 && shasum -a 256 -c documents.sha256)` and confirm every document matches. Open at least one restored private PDF through an authenticated invoice document page and verify its invoice history and reviewer reason are present.
4. Compare each PO commitment and balance with Decision's restored `commitments` rows; opening commitments must still use `kind='opening'`. Check for reservations before processing queued work.
5. Inspect Workflow jobs. Queued jobs should resume under the same job IDs; wait for completion and confirm Decision operation idempotency keys and commitment rows have not duplicated. Upload one new synthetic invoice and complete a review, then confirm one final commitment.
6. Sign in again after restore, confirm old browser sessions are rejected, and check that users/password credentials and the identity audit log were retained.

`pg_dump` and `pg_restore` run inside the Compose `postgres` container in both scripts; host-installed PostgreSQL clients are not required. The official `postgres:17` image supplies both utilities, but their actual execution is unverified here because no compatible container runtime is installed. Docker, Compose startup and restore behavior remain **unverified**. A full isolated restore drill is still mandatory. Include OCR language-model cache only when offline restart is required; it is rebuildable and does not replace document or database backups.

## Interrupted work

| Operation                         | Authoritative owner                                                                      | Persisted states and retry/reconciliation behavior                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invoice registration              | Decision (`decision_records`)                                                            | Workflow job is queued/running/completed/failed; Decision registration is committed or absent. Registration key/fingerprint is persisted. Retry the same job/key after timeout; a changed payload with the same key is rejected.                       |
| Evaluation and PO reservation     | Decision (`decision_records.evaluation`, `commitments`, `business_claims`)               | Pending evaluation can hold one reservation, no reservation, or be blocked. Workflow may lag after Decision commit. Evaluation key and response are persisted; retry/restart replays the same result. Do not manually insert or release a reservation. |
| Final approval/rejection          | Decision (`decision_records.review`, `commitments`)                                      | Pending or committed approved/rejected. A final review operation records request, stable key, actor ID when available, fingerprint and response in the same transaction as the financial change. Replay is idempotent.                                 |
| Workflow job and reviewer history | Workflow (`workflow_jobs`, `invoices`, `stage_events`)                                   | Queued/running/failed/completed, with stable job ID and lease. Final Workflow review/history/event are one database transaction. Retry only with the existing supported retry action; preserve operation and correlation IDs.                          |
| Reference import                  | Decision (`reference_import_previews`, `reference_import_operations`, `reference_audit`) | Preview is actor/fingerprint-bound and expires after 15 minutes; commit is atomic and idempotent by import ID; errors leave no partial vendor/PO/opening rows.                                                                                         |
| User/account administration       | Identity (`user`, `account`, `session`, `identity_audit`)                                | User may be active/disabled and assigned admin/reviewer/viewer. Disable revokes sessions; every admin change records stable actor ID. Restore retains users, password credentials and audit, then revokes all sessions.                                |

An administrator can scan Decision snapshots against Workflow for a committed final approval/rejection left pending in Workflow. Repair copies the Decision final state into Workflow and writes a case/event; it never creates, duplicates or releases commitments. The generation fence prevents stale evaluations after accepted corrections. Other discrepancies still require operator investigation; do not manually release a reservation because of a timeout. See [recovery-matrix.md](recovery-matrix.md) for each boundary and its evidence limits.

When extraction fails, use the original invoice's retry control after checking service and OCR readiness. Unsupported or ambiguous source values require manual verification; a successful OCR call is not evidence of accuracy. Migration import conflict handling, source/destination reconciliation and recovery after partial legacy import remain unresolved; do not apply the legacy copy to real datasets without rehearsal and independent comparison.

## Extraction evaluation and scope

Run `npm run evaluate:extraction` to generate labeled synthetic PDFs from `tests/extraction/fixtures.json`, extract them through the same PDF.js provider/parser used by the service, and report per-field exact/wrong/missing results, critical-field error rate, and warning-based review routing. The expected values live separately from runtime logic and are authored in the manifest. This fixed four-case set is a regression suite, not representative accuracy evidence. The real PDF end-to-end tests additionally cover a multi-page synthetic PDF, an unfamiliar date, and image-only OCR requiring explicit human verification. No authorized representative invoice dataset is available; real-world extraction accuracy remains **UNVERIFIED**.

Current supported inputs are PDF files up to configured size/page limits, readable text with English labels (`Supplier`, `Invoice number`, `Invoice date`, `PO reference`, `Currency`, `Subtotal`, `Tax`, `Total`) and ISO `YYYY-MM-DD` dates; image-only pages use Tesseract's English model. Parser money handling supports a simple decimal separator and strips commas. It does not calculate line items, understand arbitrary columns or handwritten/complex layouts, calibrate OCR confidence, reliably parse multilingual documents, or accept ambiguous date conventions. Such inputs must be reviewed against the original. To finish validation, obtain an authorized, consented and de-identified representative dataset across suppliers, scan quality, supported layouts, currencies and missing-field cases. A proposed sample size is at least 200 invoices; it is a study design proposal, not an accuracy target. Have two AP reviewers independently label every critical field and routing outcome, adjudicate disagreements, and report supplier-separated and category-level metrics before any accuracy claim. No such dataset is currently available.

## Exact isolated Compose verification sequence

Run these commands from Bash on a disposable Docker host with port 3000 free. The generated environment uses unique random credentials. For synthetic end-to-end processing, change `DECISION_APP_ENV=production` to `DECISION_APP_ENV=demo`; this explicitly seeds only synthetic vendor/PO data in the isolated project.

```sh
npm run compose:env -- .env.microservices
python3 -c 'from pathlib import Path; p=Path(".env.microservices"); s=p.read_text().replace("DECISION_APP_ENV=production", "DECISION_APP_ENV=demo"); p.write_text(s)'
docker compose --project-name invoicelens-validation --env-file .env.microservices up -d --build
docker compose --project-name invoicelens-validation --env-file .env.microservices ps
docker compose --project-name invoicelens-validation --env-file .env.microservices exec -T postgres psql -U invoicelens_admin -d invoicelens_workflow -Atqc 'SELECT count(*) FROM schema_migrations'
docker compose --project-name invoicelens-validation --env-file .env.microservices exec -T postgres psql -U invoicelens_admin -d invoicelens_extraction -Atqc 'SELECT count(*) FROM schema_migrations'
docker compose --project-name invoicelens-validation --env-file .env.microservices exec -T postgres psql -U invoicelens_admin -d invoicelens_decision -Atqc 'SELECT count(*) FROM schema_migrations'
docker compose --project-name invoicelens-validation --env-file .env.microservices exec -T postgres psql -U invoicelens_admin -d invoicelens_identity -Atqc 'SELECT count(*) FROM invoicelens_identity_migrations'
read -r -s -p 'Initial administrator password: ' AUTH_BOOTSTRAP_PASSWORD; echo
docker compose --project-name invoicelens-validation --env-file .env.microservices run --rm --no-deps -e AUTH_BOOTSTRAP=true -e AUTH_BOOTSTRAP_PASSWORD frontend npm run auth:bootstrap -- admin@example.invalid 'InvoiceLens Administrator'
unset AUTH_BOOTSTRAP_PASSWORD
read -r -p 'Administrator email: ' INVOICELENS_ADMIN_EMAIL
read -r -s -p 'Administrator password: ' INVOICELENS_ADMIN_PASSWORD; echo
export INVOICELENS_ADMIN_EMAIL INVOICELENS_ADMIN_PASSWORD
npm run verify:compose -- http://127.0.0.1:3000
```

The smoke command signs in, runs PDF.js extraction and English Tesseract OCR, verifies unreviewed OCR cannot be approved, records a correction and explicit scan verification, approves both synthetic invoices, and compares private document bytes with the stored SHA-256. Record the invoice IDs printed by the command. Restart the application services and run persistence mode:

```sh
docker compose --project-name invoicelens-validation --env-file .env.microservices restart extraction decision workflow frontend
INVOICELENS_VERIFY_INVOICE_IDS='TEXT_INVOICE_ID,OCR_INVOICE_ID' npm run verify:compose -- http://127.0.0.1:3000
unset INVOICELENS_ADMIN_EMAIL INVOICELENS_ADMIN_PASSWORD INVOICELENS_VERIFY_INVOICE_IDS
```

Replace the example IDs with the values printed by the first command. Persistence mode verifies the approvals, reviewer history and document hashes after restart. The repository workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the isolated service/browser suite and builds and starts Compose, checks all migration tables and the Decision authentication boundary, then runs this smoke test and verifies persistence after restart. The workflow has been **created but not executed** in this environment; a CI run is evidence only after it completes successfully.

This environment does not have Docker, Podman, nerdctl, Finch, Colima, `pg_dump` or `pg_restore`; therefore Compose startup and restore are **not verified here**. On a Docker host, run the smoke sequence above before taking a backup. Restore only into the fresh `invoicelens-validation-restore` project using a separately generated `.env.restore`, a different application port and unused volumes. Do not treat script exit as a verified restore; complete every check in “Isolated restore verification,” including invoice history, identities, PO balances, document hash manifest, queued-job recovery and no duplicated commitments.

## Company workspace continuation — 1 November 2026

The supported deployment scope is one company with multiple AP users. Different companies require separate deployments and databases; do not share this workspace across organizations. Production requires individual authentication and a recorded source check of values, item details and tax treatment for every invoice. Missing item extraction is not proof of a bundled charge. Production hides sample controls and rejects sample URLs. The existing development records are kept separately.

### Separate native workspace (locally verified; container deployment still unverified)

```sh
# Terminal 1: persistent isolated databases, no demo business records.
npm run services:production-db
# Terminal 2: independent production build and application processes.
npm run build:production-local
npm run start:production-local
```

The URL is `http://127.0.0.1:3003`; Postgres uses 54343 and service APIs use 4610/4620/4630. Configuration, private documents and databases live under `.data/invoicelens-production`; its cluster administrator password is generated independently. Development remains on port 3000 and its original data directory. E2E, development and production use `.next-tests`, `.next` and `.next-production` respectively, so test builds do not replace the running frontend's build.

For a fresh workspace only, bootstrap an administrator from **Bash** using generated configuration and a password entered privately:

```sh
set -a
. .data/invoicelens-production/gateway.env
set +a
read -r -s -p 'Initial administrator password (14+ characters): ' AUTH_BOOTSTRAP_PASSWORD; echo
export AUTH_BOOTSTRAP_PASSWORD
AUTH_BOOTSTRAP=true npm run auth:bootstrap -- '<administrator-email>' '<display-name>'
unset AUTH_BOOTSTRAP_PASSWORD
```

Bootstrap creates the user, credential, administrator role and audit record in one transaction and refuses a nonempty user database. In this workspace, the requested administrator has already been created and browser sign-in verified. Its generated initial password is in `.data/invoicelens-production/initial-admin-password.txt` with mode 0600. Change it in **My account** after sign-in and remove that initial-password file after securely retaining the new credential. Do not commit or share the file. No vendors, POs, commitments or invoices were seeded into the company workspace.

Account recovery is administrator-mediated: confirm the user's identity through the company's approved process, then use **Workspace accounts → Recover an account**. Recovery atomically replaces the password, revokes the user's sessions and records the reason and administrator in the identity audit; passwords are never in that audit. Users can change their own password in **My account**, verifying the current password and revoking other sessions.

For loss of all administrator sign-in access, an authorized deployment operator with the identity DB configuration can run the offline recovery command below. It cannot create an account, promote a user or unban a disabled administrator. The named operator and reason are audited; the password and session values are not printed.

```sh
# Load this deployment's private gateway/identity configuration first.
read -r -s -p 'New administrator password: ' AUTH_RECOVERY_PASSWORD; echo
read -r -p 'Authorized operator name or ticket: ' AUTH_RECOVERY_OPERATOR
read -r -p 'Recovery reason (20+ characters): ' AUTH_RECOVERY_REASON
export AUTH_RECOVERY_PASSWORD AUTH_RECOVERY_OPERATOR AUTH_RECOVERY_REASON
npm run auth:recover-admin -- '<existing-active-administrator-email>'
unset AUTH_RECOVERY_PASSWORD AUTH_RECOVERY_OPERATOR AUTH_RECOVERY_REASON
```

### Reconciliation and approval integrity

The administrator scan now reports missing registrations, mismatched generations/evaluations, inconsistent reservation/approval amounts, rejected invoices with commitments, orphan Decision records and unreadable or hash-mismatched private originals. In-flight jobs are excluded from financial discrepancy classification; a scan across independently changing services can still be conservative, so repeat it after jobs settle before concluding corruption. Approval independently verifies original bytes and evaluation inputs and refuses unresolved invoice reconciliation cases. Scanning does not manufacture company records or alter money.

The automated repair remains restricted to copying an authoritative final Decision review into stale Workflow state, including its original review reason and actor ID. Other corruption requires restoring verified originals/records or a separately reviewed repair. Missing registration before a request is sent is recovered by the existing durable job/lease replay. A missing completed registration is a different integrity problem and must not be recreated blindly. Legacy `--apply` is now rejected for production destinations; the preserved development workspace and supported audited reference importer remain available.

### Ingress and monitoring preparation

An optional [Caddyfile](../deploy/Caddyfile) prepares HTTPS ingress and a 27 MB request-body ceiling. It has not been executed here because Caddy and a container runtime are unavailable. On an approved host with Caddy already available, set `INVOICELENS_DOMAIN` to the approved DNS name and `INVOICELENS_UPSTREAM` to the private gateway address, update `APP_URL` to that HTTPS origin, and run `caddy validate --config deploy/Caddyfile --adapter caddyfile` before starting ingress. Configure DNS, certificates, host/volume encryption and network access under the company's deployment process. The syntax follows the [official request-body documentation](https://caddyserver.com/docs/caddyfile/directives/request_body) and [environment-variable documentation](https://caddyserver.com/docs/caddyfile/concepts#environment-variables); this is configuration review, not runtime verification.

Workflow exposes internal bearer-authenticated Prometheus metrics at `/v1/metrics`: job/invoice states, oldest queued age, heartbeat age, open reconciliation cases and storage capacity. It exposes no invoice values. Never publish service metrics or internal tokens to the browser/public network. [Example alert rules](../deploy/prometheus-alerts.yml) are prepared; queue/disk thresholds are proposed operational defaults requiring operator approval. An actual Prometheus/alert destination and on-call response are not provisioned. Authentication throttling and individual-user write limits now use the identity database across gateway processes; local development retains an in-memory write limiter.

### Restore implementation corrections and limits

The restore script now explicitly mounts the target project's persistent document volume into the copying container; copying only into a temporary container would lose the restored documents. It verifies restored volume names and bytes against the backup, checks source document hashes and available database archive hashes, waits for all four target databases to initialize, uses `pg_restore --exit-on-error`, and supports Bash 3 without uppercase parameter expansion. These changes have syntax checks and a standalone document-comparison regression, but no complete Docker restore execution.

For a controlled drill, `INVOICELENS_RESTORE_START=false npm run restore:compose -- <backup> <fresh-restore-project> <new-env-file>` restores without starting application writers. Compare database counts and commitments first, then start the new project with its exact Compose/env arguments and verify job recovery. The CI workflow prepares an explicitly isolated synthetic queued duplicate before backup, compares restored counts before worker startup, then checks that the queued job recovers without a commitment and that prior approvals/history/private documents survive. The workflow has still not run. Do not label backup/restore verified from script existence, native application startup or standalone file-comparison tests.
