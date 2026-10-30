# Architecture

## Components and boundaries
- `src/lib/extraction.ts`: ExtractionProvider interface, PDF.js text extraction; insufficient-text pages render to a bounded canvas and use Tesseract English OCR. Label parser returns typed normalized fields, original values, page text, warnings and version. No fixture manifest access. No prompt execution.
- `src/lib/types.ts`, `money.ts`, `rules.ts`: schema validation and pure versioned policy. BigInt minor units. No LLM decisions.
- `src/lib/schema.ts`, `db.ts`, `migrations`: Drizzle tables and parameterized database access. Version-recorded SQL migration in a transaction.
- `service.ts`: upload transaction, audit, review, evaluation and reservations. A workspace advisory transaction lock orders financial mutations. Unique invoice reservation and business identity keys are a second defense.
- `storage.ts`: private storage interface. UUID-generated storage keys, restrictive file permissions, explicit content/extension/size validation. Downloads use invoice IDs with workspace authorization.
- `scripts/worker.ts`: durable leased jobs, heartbeat, restart recovery and persisted stages. Extraction runs in a killable child process with a 120-second timeout. No browser request waits for extraction.
- API route: authorization, same-origin write checks, schema validation, request limits, sanitized error responses. `src/proxy.ts` protects page entry points.
- `workspace.tsx`: dashboard, upload, real run timeline, detail/evidence, corrections, PO choice, review, reference records, policy. Polling is a deliberate alternative to SSE; it reads persistent snapshots every 1.5 seconds with reconnect feedback.

## Data model
`vendors` holds approval, identifiers and aliases. `purchase_orders` holds supplier, currency, eligibility and integer limit. `invoices` holds file hash/key, execution state and typed JSON evidence, revisions and evaluation snapshots. `commitments` holds one active reservation per invoice and a unique business key; imported historical approved invoices are also included. `jobs` holds attempts/leases. `events` is an append-only run-event sequence. `worker_heartbeat` supports readiness.

Evaluation snapshots preserve rule version, inputs, matching records, candidates, findings, balance calculations and commitments. Original extraction remains immutable during reviewer correction. Approvals/rejections are final in this UI; post-finalization administrator revisions are a documented limitation.

## Job lifecycle
Upload atomically registers queued invoice/job. Worker claims with FOR UPDATE SKIP LOCKED, increments attempts, grants 180-second lease and renews every 10 seconds. Expired jobs are requeued up to 3 claims or marked failed with a recovery event. Finished invoice state repairs an interrupted job completion. Stages save actual starts/ends, status and findings. Completed extraction is reused. Reservations delete/replace their own primary key inside the same locked transaction. Failed/unreadable extraction does not create a recommendation. Transient extraction failures retry at most twice, each in a child process with a 120-second timeout. Invalid/encrypted/over-limit documents fail without retry. Exhausted failures allow explicit user retry; interrupted jobs recover within the stated job-attempt bound. The extraction process receives no workspace/database credentials.

## Security and deployment
One private workspace. Local mode requires a loopback host and non-production environment; provided launch commands bind loopback. Deployment uses environment-configured Basic auth over HTTPS. Same-origin checks protect modifying requests. Every document endpoint requires workspace authorization. Original PDFs live outside public; demo samples are intentionally public synthetic data. Routine logs contain event/run IDs, not document bodies or credentials. PDFs run in a bounded subprocess; PDF.js JavaScript actions are never executed as application instructions. English model download transfers no document contents.

Deploy web + worker + PostgreSQL with a shared persistent private filesystem. Container configuration is provided but unverified here. External object storage can implement the storage interface. Polling and the workspace-wide lock fit assessment scale; multiple tenants and high throughput need narrower financial locks, explicit tenancy, distributed rate limits, identity/roles, session management, immutable external audit retention, malware/resource isolation, retention/deletion policy, alerting, backup/restore drills, invoice-layout evaluation and reviewed financial integrations. This is not a payment system or production-certified financial platform.
