# Requirements matrix

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Real text and scanned PDFs | extraction.ts PDF.js + Tesseract, killable child | provider:check; five-scenario smoke; E2E actual OCR |
| Typed schema, original/normalized values, evidence | types.ts; extraction.ts; invoice JSON state | Detail Document evidence and original PDF |
| No fake confidence or fixture runtime decisions | explicit warnings; manifest only under fixtures | Inspect runtime imports; scan total remains null |
| Versioned deterministic decisions | rules.ts, config policy, money.ts | rules.test.ts; business-rules.md |
| Required fields/date/amount precision/arithmetic | fieldsSchema, evaluate, BigInt minor units | Unit tests, correction workflow |
| Approved suppliers and registered aliases | vendors table; identifier/alias matching | Unit tests; reference screen |
| PO matching, ambiguous candidates and human selection | rules.ts, review service; candidate selector | E2E ambiguous-po scenario |
| PO supplier, currency, eligibility | deterministic findings | Unit currency/vendor tests |
| Cumulative usage and hard limit | commitments; locked evaluation/reservation | Split fixture shows prior INR 70000 and excess INR 10000 |
| Concurrent actions/idempotence | advisory transaction lock, unique PK/business identity | Real DB concurrent reservation/approval tests |
| File hash and normalized business duplicate key | upload SHA256; evaluateAndReserve | Changed-name PDF E2E + DB changed-byte test |
| Separate execution/recommendation/review | status, evaluation.decision, review state | Failed corrupt PDF vs completed NEEDS_REVIEW |
| Review reason, correction, reject, approve, rerun | service.review; detail controls | E2E correction and selection; DB hard-control/approval/rejection tests |
| Immutable original and evaluation/revision audit | extraction retained; history snapshots; events table | E2E checks original total null after correction |
| Actual live stages, timestamps, elapsed time | updateStage; DB snapshots and events; polling | Timeline during OCR, reload E2E |
| Durable recovery, bounded attempts, no repeated extraction | jobs leases/heartbeat; recoverJobs; stored extraction | DB expired-lease tests and rerun skips extraction |
| Private storage and authorized documents | storage.ts, auth.ts, API document handler, proxy.ts | Unauthorized access tests; files outside public |
| Input/content/size/page/encryption safety | validateUpload, PDF.js errors, limits and child timeout | Unit validation; E2E corrupt/page limit; provider failure behavior |
| Secret/config validation, CSRF, rate/resource limits | config.ts, auth.ts, API | Cross-origin tests, .env.example, guarded production auth |
| Real metrics/history/search/filter/pagination | dashboard + API stored records | E2E dashboard search; manual Chrome inspection |
| Drag/drop/upload/downloadable demos | upload screen; sample API; private uploaded original endpoint | Browser sample actions and file-input tests |
| Reference dataset and commitments | records screen + exported JSON | Browser records inspection |
| Policy/readiness | policy screen; /api/health; provider:check | Actual provider check vs configuration explicitly distinguished |
| Desktop/mobile, focus and status text/icons | responsive globals.css; reusable badge; native controls | Desktop Chrome, Playwright 393px viewport checks |
| PostgreSQL/ORM/migrations | schema.ts; migrate.ts; 0001_initial.sql | Real PostgreSQL integration and fresh E2E database migration |
| Five realistic fixtures and manifest | scripts/fixtures.ts; public/samples; fixtures/manifest.json | Actual extraction smoke; E2E |
| Reproducible setup/deploy/reset | README, .env.example, Dockerfile/Compose, reset guard | Local setup verified; Docker deployment unverified |
| Five-minute video/interview plan | demo-script.md; demo-runbook.md | Script targets 4:45; recording itself is user-owned |
| Limitations stated without certification claims | README/architecture/verification | Conservative parser, shared reviewer, deployment caveats explicit |
