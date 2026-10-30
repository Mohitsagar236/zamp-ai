# Demo runbook

## Readiness
1. Install Node 22.13+, `npm ci`, copy `.env.example` to `.env`.
2. Terminal A: `npm run db:local`. Terminal B: `npm run db:migrate && npm run db:seed`.
3. `npm run provider:check` warms the English OCR model and verifies text and image-only paths without adding invoice records.
4. `npm run build`. Terminal B: `npm start`. Terminal C: `npm run worker`.
5. Open exactly http://127.0.0.1:3000; policy page should show database and worker ready. API `/api/health` must show worker ready. Do not start a recording while the worker is offline.
6. Run in the scenario order below. The sample buttons actually upload the downloaded PDF; no manifest drives the runtime.

## Scenarios / expected extraction and decisions
All examples use ISO invoice date 2026-10-26 and INR. Starting DB is the seeded dataset with no uploaded runs. Suppliers are matched by registered identifiers. The five synthetic PDFs and reference-records.json are downloadable from Upload.

| Input | Extracted fields | Starting records | Decision / reason | Balance effect / human |
| --- | --- | --- | --- | --- |
| happy-path.pdf | Northstar, GST-NORTHSTAR-01, NS-2026-1042, PO-2026-101, subtotal 20000, tax 3600, total 23600 | Approved supplier; open INR 200000 PO | READY_FOR_APPROVAL; required, arithmetic, identity, currency, balance pass | Reserve INR 23600; optional approve with reason |
| duplicate-renamed.pdf | Identical to clean PDF, different filename | Clean original already processed | BLOCKED / DUPLICATE; link original | Zero additional allocation; no approval bypass |
| split-overbalance.pdf | Cloudline, GST-CLOUDLINE-03, CL-2026-204, PO-2026-200, subtotal 33898.31, tax 6101.69, total 40000 | INR 100000 limit; imported HIST-001 commitment INR 70000 | BLOCKED / PO_BALANCE; INR 10000 excess | No reservation; resolve business order outside this UI |
| scan-missing-total.pdf | Image-only PDF. OCR: Northstar, NS-2026-SCAN, PO-2026-101, subtotal 10000, tax 1800, total null | Same approved Northstar and available order | NEEDS_REVIEW / missing total | Zero until verified correction. Enter total 11800.00 with reason, rerun → ready, reserve INR 11800 |
| ambiguous-po.pdf | Meridian, GST-MERIDIAN-02, SM-2026-089, no PO, subtotal 10000, tax 1800, total 11800 | Two open INR 100000 POs: PO-2026-301/302 | NEEDS_REVIEW / PO_AMBIGUOUS; both candidates | Zero until human selects confirmed order with reason; rerun → ready |

Expected results are test documentation; the parser reads actual bytes. A second upload after demonstration is correctly a duplicate, not a fresh happy path. Use corrections on the original record. Scan correction demo is based on the documented synthetic scenario; real operations require independent supplier verification.

## Safe reset
Stop worker (Ctrl-C), wait at least 20 seconds, then `npm run demo:reset -- --confirm-demo-reset`. It requires APP_ENV=demo and the exact demo database name. It refuses an active worker heartbeat and production. It resets database demo records, not private file storage. Restart worker. Do not reset the database during recording or against live financial data. E2E uses its own explicitly disposable invoicelens_e2e database.

## Live troubleshooting
No API credentials or paid services needed. Initial model download needs internet; warm via provider:check for offline interview use. If provider check fails, label scans unverified until fixed; never substitute fixture JSON. Worker logs show run IDs without document contents. Corrupt/encrypted/over-page-limit files show processing failure; retry after fixing the input/setup. Request origin must exactly match APP_URL. Persistent queued work resumes after the worker starts. Lease recovery takes up to 180 seconds after a hard crash; automatic retries stop after 3 attempts.

For a restart demonstration: note invoice ID and decision, stop app and worker, restart them with unchanged database/storage, open the same detail URL and dashboard. Stored extraction is reused; no new OCR request occurs on refresh.
