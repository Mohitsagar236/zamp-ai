# Verification results

Verified locally on **31 October 2026 (Asia/Kolkata)**, macOS arm64, Node 22.23.4, PostgreSQL 18.6 local engine. No paid services, provider mocks, external deployment or real private invoices were used.

| Check | Result |
| --- | --- |
| TypeScript (`npm run typecheck`) | Pass |
| ESLint (`npm run lint`) | Pass |
| Vitest unit + actual PostgreSQL integration | **30 tests passed** across 2 files |
| Next.js production build (`npm run build`) | Pass |
| Playwright against production build | **4 suites passed** in 27.9 seconds |
| Actual text PDF extraction | PDF.js extracted all required clean-invoice fields; READY_FOR_APPROVAL |
| Actual image-only PDF extraction | Tesseract OCR read scan; obscured total remained null; NEEDS_REVIEW |
| Duplicate changed filename | BLOCKED; linked original; zero additional reservation |
| Split invoice | BLOCKED; INR 100000 limit minus INR 70000 committed = INR 30000 available; INR 40000 request, INR 10000 excess |
| Two plausible POs | NEEDS_REVIEW; PO-2026-301 and PO-2026-302; no arbitrary choice |
| Verified correction and PO selection | Browser actions reran checks and reached ready; original extraction retained |
| Real DB concurrency | One of two concurrent INR 60 reservations against INR 100 succeeded; other blocked; repeated approval did not double count |
| Corrupt, encrypted and over-page-limit files | Visible execution failures; no successful extraction or decision |
| Basic auth and document authorization | Temporary production-auth server: unauthorized pages/PDFs 401; valid credentials 200; cross-origin write 403 |
| Persistence after service restart | All 5 complete invoice snapshots byte-for-byte unchanged after PostgreSQL, web and worker restart |
| Live-view refresh | Browser reload retained actual stored stage state and result |
| Mobile browser | 393 × 851 Chromium viewport, core screen navigation without whole-page horizontal overflow; tables scroll within panels |
| Automated accessibility | Axe WCAG 2 A/AA + 2.1 AA tags: zero violations on overview, upload, records, policy and scanned-invoice detail |
| Manual browser inspection | Chrome desktop dashboard inspected through accessibility tree and screenshot |

The four E2E suites contain many workflow assertions: actual upload/extraction and review, input/security failures, mobile navigation, automated accessibility. They use a separate explicitly disposable `invoicelens_e2e` database and worker; the five-scenario smoke also ran through the normal demo workspace. No fixture manifest is imported by runtime code. Actual provider verification is independently repeatable with `npm run provider:check`.

## Remaining verification and operational limits
- Docker/Compose deployment: **unverified** because Docker is unavailable here. Follow README deployment commands on a Docker-equipped host and repeat health/provider/E2E checks.
- Physical Android device: **unverified**; mobile Chromium viewport checks passed. Test the authenticated HTTPS deployment on a physical Android browser before distribution.
- Automated WCAG checks and visible focus do not constitute a full manual accessibility audit.
- Extraction is a conservative English label parser with local OCR. Complex arbitrary layouts, multilingual invoices and automatic tabular line-item parsing are outside this implementation; missing/unreadable fields route to review. No calibrated confidence or regulatory certification is claimed.
- Identity is one shared workspace reviewer. Fine-grained roles, post-finalization administrator revisions and operational payment integrations are not implemented.
- Model download needs internet initially; warm and retain `.data/ocr` before an offline demo.
