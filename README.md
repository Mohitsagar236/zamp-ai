# InvoiceLens

An accounts-payable review workspace: upload a real invoice PDF, watch persisted processing stages, inspect the evidence, and act on an explainable recommendation. Ready is a recommendation with a PO reservation, never a payment.

## Start locally

Prerequisites: Node.js **22.13+**, npm, and a supported macOS/Linux/Windows architecture. The lockfile is included. No paid API key is needed. OCR uses local Tesseract.js; the first scan downloads the public English language model and caches it under `.data/ocr`. Documents are processed locally.

```sh
cd zamp
npm ci
cp .env.example .env
npm run db:local
```

Leave PostgreSQL running. In another terminal:

```sh
npm run db:migrate
npm run db:seed
npm run build
npm start
```

In a third terminal:

```sh
npm run worker
```

Open **http://127.0.0.1:3000** → Upload invoice → Process sample. Start with the clean invoice, then the renamed duplicate. Original uploads and all decisions persist in `.data` and PostgreSQL across restarts. `npm run dev` is available instead of the build/start commands. Do not run dev and build concurrently against the same `.next` directory.

On the machine used to build this project, Node is available at `/Users/mohitsagar/.local/share/invoicelens-tools/node-v22.23.4-darwin-arm64/bin`; add that directory to PATH if Node is not otherwise installed. This path is optional and machine-specific; a normal Node installation is sufficient on a fresh checkout.

Sample PDFs are already checked into `public/samples`. `npm run fixtures` regenerates them and exports the seeded reference dataset; it requires a running migrated database. The fixture manifest is test documentation only, never imported by runtime code.

## Environment

See `.env.example`. `DATABASE_URL` can point to a separately managed PostgreSQL 17+ server instead of the optional embedded local server. Local PostgreSQL is persistent at `.data/postgres`, port 54329. The demo database is `invoicelens_demo`; its published password is for loopback demo use only.

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection, required |
| APP_URL | Exact browser origin; default http://127.0.0.1:3000 |
| APP_ENV | demo, test, production; production forbids local auth |
| AUTH_MODE | local (loopback only), or basic |
| WORKSPACE_USER / WORKSPACE_PASSWORD | Basic auth user and unique password (at least 16 characters) |
| STORAGE_DIR | Private document directory, never under public |
| OCR_PROVIDER | tesseract or disabled |
| MAX_FILE_MB / MAX_PAGES | Resource limits, default 10 / 10 |
| ROUNDING_TOLERANCE_MINOR | Arithmetic tolerance, default 1; does not relax hard PO limits |

Configuration is schema-validated. A worker must run separately. Check `/api/health`: database ready, worker ready, OCR configured. Health requires the same workspace authorization as invoice endpoints. OCR configuration is not proof of successful extraction; run `npm run provider:check` to verify actual text and scanned samples.

## Architecture

Next.js App Router + TypeScript + Tailwind CSS, Drizzle ORM + PostgreSQL, a PostgreSQL job queue, private local file storage, PDF.js and Tesseract OCR. A process-bounded extraction provider is separate from deterministic rules. The UI polls stored state every 1.5 seconds; events and snapshots reconstruct the run after refresh. A workspace transaction lock and unique reservation identities prevent duplicate commitments and concurrent overspending. See [architecture](docs/architecture.md), [policy](docs/business-rules.md), and [process map](docs/process-map.md).

## Verification

```sh
npm run typecheck
npm run lint
npm test                    # unit + real PostgreSQL integration; migrate/seed first
npm run build
npx playwright install chromium
npm run test:e2e             # actual browser + extraction, separate disposable invoicelens_e2e database
npm run provider:check      # actual PDF.js and actual Tesseract, no mock
npm run auth:check          # starts temporary authenticated server on port 3002; requires an uploaded demo invoice
npm run smoke               # uploads all five samples into the current workspace; run on a fresh demo
```

The E2E harness creates/resets **only `invoicelens_e2e`** and uses port 3001, while keeping the normal demo untouched. It requires the configured DB role to have CREATE DATABASE privileges. Unit/integration tests clean up their own `test-*` records; do not run them concurrently with a worker for that same database. E2E has its own worker. Real provider tests and database tests are separate from mocks: the included suite uses no provider mocks. See [verification results](docs/verification.md).

## Demo

- [Five-minute script](docs/demo-script.md)
- [Setup, scenario expectations and safe reset](docs/demo-runbook.md)
- [Requirement coverage](docs/requirements-matrix.md)
- [Sample PDFs](public/samples) and [fixture expectations](fixtures/manifest.json)

Reset is deliberately guarded:

```sh
# Stop the worker and wait 20 seconds, then:
npm run demo:reset -- --confirm-demo-reset
```

It refuses production/non-demo environments, databases not named `invoicelens_demo`, or a recently active worker. Documents remain in private storage after reset; no production database can be silently reset by this command.

## Deployment

Use a long-running Node server and worker with shared private document storage and PostgreSQL. Do not use a request-only/serverless deployment for the worker. HTTPS, authorization and a strong replacement workspace password are required before public access. Basic auth represents one shared workspace reviewer; it is not a multi-user identity system.

A Dockerfile and Compose topology are provided, but Docker execution has not been verified on this machine. Set `DB_PASSWORD`, `APP_URL` and `WORKSPACE_PASSWORD` in an untracked environment file, then:

```sh
docker compose build
docker compose up -d database
docker compose run --rm web npm run db:migrate
docker compose run --rm -e APP_ENV=demo web npm run db:seed  # synthetic assessment data only
docker compose up -d web worker
```

Synthetic seeding refuses APP_ENV=production; the explicit APP_ENV=demo command above opts into assessment data. For operational deployment, omit that command and load reviewed reference records. Keep the web port behind an HTTPS reverse proxy; preserve Host and Origin. Back up PostgreSQL and private document storage together. Run migrations as a single deployment step, not concurrently across replicas. The image retains dev dependencies because the TypeScript worker uses tsx; a compiled worker image is future optimization.

## Troubleshooting and limits

- **Worker offline / queued forever:** start `npm run worker` with the same environment; health needs a heartbeat within 30 seconds.
- **Wrong-origin error:** open exactly APP_URL, including host and port. `localhost` and `127.0.0.1` are different origins.
- **Scan fails on first run:** allow the public English model download, then run provider:check. No invoice is sent to that download service. Offline demos need the model cached beforehand.
- **Corrupt/encrypted PDF:** upload a readable, unlocked copy. A failed extraction never yields a successful recommendation.
- **Repeated demo becomes duplicate:** expected. Retry/correct the existing record or use the guarded demo reset.
- **Port 54329 busy:** use a managed PostgreSQL DATABASE_URL, or stop the other local demo server.
- **Unfamiliar invoice layout:** the included conservative parser recognizes labelled English fields and ISO dates. Missing/unclear values need review. It is not a general-purpose commercial document intelligence engine. Arbitrary tabular line-item extraction is not implemented; bundled charges are supported.
- No calibrated OCR confidence is claimed. No generative model is given tools or secrets. Document text cannot change rules.
- Single workspace, shared reviewer identity, single-host private storage, in-process rate limiting, a serialized financial lock, and no payment integration. Additional operational hardening is described in architecture.md. No compliance or production certification is claimed.

The optional embedded-postgres development wrapper is upstream beta-tagged and pinned; its PostgreSQL engine and the application dependencies are pinned in the lockfile. Use managed PostgreSQL for deployment. Physical Android hardware and container deployment were not tested; mobile browser verification uses a 393px Chromium viewport.
