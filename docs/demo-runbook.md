# Demo runbook

## Start and readiness

1. Install Node.js 22.13+, run `npm ci`, and copy `.env.example` to `.env`.
2. Start the isolated service database with `npm run services:db`; leave it running.
3. In a second terminal run `npm run dev`. This starts Extraction, Decision, Workflow, and the Next.js frontend.
4. Open <http://127.0.0.1:3000>. The workspace status should show processing available. `/api/health` must report the workflow database, worker, Decision, and Extraction as ready.
5. The English Tesseract model downloads on the first image-only PDF. Warm it before a time-limited demo by processing `scan-missing-total.pdf` once.

The UI uploads actual PDFs from `public/samples`. The fixture manifest is documentation and does not drive runtime decisions. Local service databases live under `.data/invoicelens-services`; stop the app before copying that directory as a backup. Restarting the database or application does not clear stored invoices, documents, or references.

## Scenarios and expected outcomes

All sample documents use INR and a synthetic 2026-10-26 invoice date. References are seeded in demo mode. See [business rules](business-rules.md) for exact controls.

| PDF                      | Expected result      | Evidence and next action                                                                                                                                             |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `happy-path.pdf`         | `READY_FOR_APPROVAL` | Northstar, INR 23,600, open PO-2026-101; funds are reserved, then a reviewer may approve with a reason.                                                              |
| `duplicate-renamed.pdf`  | `BLOCKED`            | Same document hash as the clean invoice despite its filename; link to the earlier invoice and no new commitment.                                                     |
| `split-overbalance.pdf`  | `BLOCKED`            | Cloudline PO-2026-200 has a synthetic INR 70,000 prior commitment against an INR 100,000 limit; this INR 40,000 invoice exceeds the available balance by INR 10,000. |
| `scan-missing-total.pdf` | `NEEDS_REVIEW`       | Tesseract reads the scanned page but cannot derive the missing total; enter a verified INR 11,800 correction with a reason to re-run the checks.                     |
| `ambiguous-po.pdf`       | `NEEDS_REVIEW`       | Two Meridian orders match; a reviewer selects the confirmed PO with a reason before checks can recommend approval.                                                   |

Repeat uploads are correctly duplicates. Use another synthetic invoice number only after explicitly copying a new fixture and preserving the original document/hash relationship. For a clean interview demo, use the disposable E2E databases rather than resetting local service data.

## Recovery and troubleshooting

- If `/api/health` reports a downstream service unavailable, restart `npm run dev` and confirm ports 4100–4300 are free. Durable queued work remains in the workflow database.
- If a process stops mid-job, the lease expires and the workflow service requeues it. Repeated interruptions are bounded and appear in the persisted event history.
- An extraction failure does not create an approval recommendation. Corrupt, encrypted, oversized, and over-page-limit PDFs fail visibly.
- Keep the same `APP_URL` as the browser origin; write requests with a different Origin are refused.
- OCR downloads the English model from the public Tesseract language data service once. Original PDFs are processed locally and are not uploaded to a third-party extraction API.
- Local generated credentials are in `.data/invoicelens-services/*.env`, mode 0600. Do not commit or share them.

There is no reset command in the normal demo path. Preserve local records by default. To rehearse disposable data resets or the legacy copier, use the test-only environment created by `npm run test:e2e` or a separately cloned dataset.

## Remediation follow-up

The assessment workspace remains a shared-credential demo. OCR invoices require confirming extracted values against the original scan in the correction dialog before approval. The current system is not authorized or prepared for a real-data pilot; see [the remediation tracker](remediation-tracker.md) and [operations guidance](operations.md).
