# InvoiceLens

InvoiceLens is an accounts-payable review workspace. It processes original PDF bytes, records evidence and workflow history, explains deterministic recommendations, and reserves purchase-order capacity for invoices that are ready for human review. It does not pay invoices.

## Run the company workspace

Prerequisites: Node.js 22.13+ and npm. This application is scoped to one company with multiple AP users. PDF.js and English Tesseract OCR run locally; invoices are not sent to an external extraction provider. The first scanned PDF downloads the English OCR model.

```sh
npm ci
npm ci --prefix packages/contracts
for service in workflow extraction decision; do npm ci --prefix "services/$service"; done
npm run services:production-db
```

Keep the database command running. In another terminal:

```sh
npm run build:production-local
npm run start:production-local
```

Open <http://127.0.0.1:3003>. This is an unseeded workspace with individual authentication, separate service databases and mandatory source verification before approval. Set up the initial administrator using the procedure in [operations.md](docs/operations.md), then import your company's approved vendors, POs and opening commitments through Reference records. No sample procurement records are inserted. The database, documents and private configuration live under `.data/invoicelens-production`; restarting reuses them.

This local runtime is verified separately from container deployment; it is not evidence that a hosted deployment or backup/restore drill has passed. Public-data evaluation currently confirms a serious extraction scope limitation; see [public-invoice-evaluation.md](docs/public-invoice-evaluation.md).

The existing development workspace remains available with `npm run services:db` and `npm run dev` on port 3000. It uses its existing `.data/invoicelens-services` records and can include synthetic references. Production, development and E2E builds use separate Next.js output directories.

## Architecture

The Next.js application is a same-origin gateway and UI. It forwards API calls to three independently runnable Node services. Each service has its own package, container image, credentials, Postgres database, SQL migrations, and health endpoint. Only versioned HTTP contracts connect the services. See [the architecture and ownership map](docs/architecture.md).

| Service          | Owns                                                                                       | HTTP port (local) |
| ---------------- | ------------------------------------------------------------------------------------------ | ----------------: |
| Workflow         | Private originals, invoice state, durable jobs, stages, reviews, and audit events          |              4100 |
| Extraction       | PDF parsing, OCR, content-hash cache, extraction provenance                                |              4200 |
| Decision         | Vendors, purchase orders, policies, duplicate claims, evaluations, reservations, approvals |              4300 |
| Frontend gateway | Browser auth, same-origin checks, request limits, UI                                       |              3000 |

The service APIs require bearer credentials. The gateway passes the configured workspace credential to Workflow; Workflow alone has credentials for both downstream APIs. Each service connects only to its own database. Readiness is available at `/api/health` and reports downstream service and worker status. The company workspace uses individual Better Auth accounts and administrator/reviewer/viewer roles. Local/Basic access remains available only outside production for development. All services require their own credentials; source verification and policy checks remain authoritative on the server.

## Container deployment

Docker and Docker Compose are required. The Compose topology creates four databases and four login roles inside the PostgreSQL container; application services receive only their own connection string. Migrations run as one-shot containers before the APIs start.

```sh
npm run compose:env -- .env.microservices
# Set APP_URL to the approved HTTPS origin before hosted use.
docker compose --env-file .env.microservices up --build
```

For a local deployment, use `APP_URL=http://127.0.0.1:3000`; for a hosted deployment, set the public HTTPS origin and terminate TLS at a trusted proxy. Compose uses individual authentication with independent signing and service secrets. Postgres and service ports remain private to the Compose network; only the frontend binds to loopback by default. Persistent database, document, and OCR-cache volumes are separate. The supplied environment defaults to `DECISION_APP_ENV=production` and does not seed business records. Provision approved company references through the audited administration tools. Demo mode must be enabled explicitly for isolated synthetic checks.

`.env.microservices` and `.env` are excluded from image builds and version control. Rotate every generated service and database secret before exposing a deployment. Changing Postgres initialization credentials requires a new empty volume or an explicit database-role rotation procedure; editing the env file alone does not change credentials in an existing volume.

## Moving data from the previous single-database build

The legacy database and document directory remain untouched. The copy tool reads a consistent, read-only database snapshot, verifies every source PDF against its stored SHA-256 hash, and writes into the isolated Workflow and Decision databases. It defaults to a dry run and never drops or updates legacy records.

1. Back up the legacy database and document directory using your normal backup process.
2. Start and migrate the new service databases with `npm run services:db`.
3. Preview an explicit source database URL:

   ```sh
   npm run migrate:legacy -- --source-env=.env
   ```

4. Review the source counts, then add `--apply` to copy the records and files:

   ```sh
   npm run migrate:legacy -- --source-env=.env --apply
   ```

The copy is retryable: per-service import markers prevent duplicate events and invoice records. Queued/running legacy work is requeued with a fresh lease. Completed recommendations, review history, commitments, and original PDFs are carried forward. Keep the original DB and files until the new service’s invoice counts, decisions, PDFs, and commitments have been checked. See the detailed [migration notes](docs/architecture.md#migration-and-recovery).

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:all
```

`npm run test:e2e` builds the frontend, starts an ephemeral PostgreSQL cluster and three isolated service databases, then exercises real PDF extraction, OCR, duplicate detection, PO balance enforcement, corrections, reviews, authorization, mobile layouts, and accessibility in Chromium. It does not connect to the local demo or legacy database. Install the Playwright Chromium browser once with `npx playwright install chromium`.

Each service builds from its own dependencies plus the separately installed shared contracts package:

```sh
for service in workflow extraction decision; do (cd "services/$service" && npm run build); done
```

Docker Compose images could not be run on the current development machine if Docker is unavailable; use a Docker-enabled environment to validate the image build and container health checks.

See [operations and recovery](docs/operations.md) for backup/restore and recovery guidance and [the remediation tracker](docs/remediation-tracker.md) for the remaining internal-pilot blockers.

## Product and assessment documentation

- [Business rules](docs/business-rules.md)
- [Five-minute demo script](docs/demo-script.md)
- [Demo runbook](docs/demo-runbook.md)
- [Assessment requirement coverage](docs/requirements-matrix.md)
- [Prior assessment audit](docs/audit-report.md)
- [Prior UI/UX review](docs/ui-ux-review.md)
