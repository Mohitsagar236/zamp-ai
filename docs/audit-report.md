# InvoiceLens audit against PS-1 and the implementation specification

Audit date: **31 October 2026, Asia/Kolkata**. Audited commit: **`679389fa11e0435e0c773527b2a7b827e421baeb`**. The working tree was clean at the start. This report is based on source inspection and new executions, not the earlier completion message or `docs/verification.md`.

**Application code was not changed.** All mutating checks used an archived checkout under `.data/audit-20261031/checkout`, a newly initialized PostgreSQL instance on port **54339**, and separate document storage. The existing application/database on ports 3000/54329 were not reset, stopped, or written to. The stock E2E harness's schema reset ran only in a newly created database in the isolated audit cluster. No deployment, paid service, or real financial transaction was performed.

The candidate guide exists at `/Users/mohitsagar/Downloads/ASA Case Study — Candidate Guide.pdf`, but opening its contents failed with macOS **`EPERM: operation not permitted`**. Its contents and any additional submission obligations are **UNVERIFIED**. The detailed implementation specification supplied in the earlier pasted request was available and was used. A readable copy of the candidate guide is needed before final submission sign-off.

Portable observations are retained in [audit-evidence.json](audit-evidence.json). Command logs, generated adversarial PDFs, screenshots, and temporary probe programs are retained locally under `.data/audit-20261031/evidence` and `.data/audit-20261031/checkout/.data/audit-tools`. These contain synthetic assessment documents, not private invoices. Source references below refer to the audited commit's files and line numbers.

## 1. Overall verdict

| Readiness question | Verdict | Basis |
| --- | --- | --- |
| Ready for a local demo? | **YES, for the documented, curated scenarios, with qualifications.** | Real text extraction, actual image-only OCR, all five scenarios, corrections, PO selection, persisted dashboard, and browser refresh passed. Start with a fresh demo workspace or existing original runs; repeated uploads correctly become duplicates. Do not claim arbitrary-layout extraction, immutable finalization, or fully safe multi-worker recovery. |
| Ready for assessment submission? | **NOT YET.** | Standard tests pass, but additional real PDFs reached unsafe ready recommendations, corrections can retain the wrong PO, and API review finalization is inconsistent. Worker write fencing is missing. Original-guide reconciliation, a reviewer-accessible run link, and actual timed/video evidence remain incomplete or unverified. |
| Ready for public deployment? | **NO.** | Basic authentication works locally, but authenticated HTTPS deployment and Docker/Compose operation were not verified. Fix the integrity defects and Docker secret-file exclusions first. Current shared identity, local storage, and process-local rate limiting are documented assessment choices, not evidence of operational readiness. |

The application is a substantial working assessment implementation. It is not just screens or fixture JSON. Passing the current suite does **not** establish that all extraction, review, and recovery invariants hold.

## 2. Requirements matrix

Status definitions: **COMPLETE** = implemented and verified within the stated scope; **PARTIAL** = some paths verified but a requirement gap remains; **MISSING** = absent; **BROKEN** = an implemented path failed verification; **UNVERIFIED** = insufficient evidence or a blocked check. A COMPLETE curated scenario does not imply arbitrary-document coverage.

| Requirement | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Real text PDF upload to persisted decision | COMPLETE | `service.ts:15–67`; `extraction.ts:85–162`; fresh `npm run smoke`: NS-2026-1042 → READY_FOR_APPROVAL, INR 23,600, PO-2026-101. | Broaden layout robustness separately. |
| Actual image-only scan and real OCR | COMPLETE | PDF.js inspection: 1 page, **0 text items**, 1 image-paint operation; rendered blacked-out total inspected. Fresh Tesseract output: total null, NEEDS_REVIEW. `scan-structure.json`, `provider.log`. | Physical capture quality/multilingual coverage not established. |
| Samples invoke real processing rather than fixed answers | COMPLETE | UI `workspace.tsx:234–242` downloads PDF bytes and calls upload. Runtime imports do not reference the fixture manifest. Real extraction smoke and E2E passed. | None for provided scenarios. |
| Typed extraction and original/normalized evidence | COMPLETE | `types.ts:1–50`; `extraction.ts:29–80,142–162`; original total remains null after ordinary correction. | Whole provider envelope is cast rather than fully schema-validated; strengthen before adding providers. |
| Critical-field uncertainty and conflicting evidence | BROKEN | A real PDF with Total 118.00 and Total 1180.00 became ready with **zero warnings**. `extraction.ts:18–38`; issue A02. | Detect conflicting critical values and route to review. |
| Line items when available; arithmetic tied to extracted evidence | PARTIAL | Rules validate supplied line items (`rules.ts:90–139`), but runtime extraction always returns `[]` (`extraction.ts:71`). Actual 2 × 100 = 100 discrepancy was silently treated as bundled and ready. | Extract supported lines or explicitly flag unsupported visible line detail for review; A03. |
| Required fields, total arithmetic, precision and rounding | COMPLETE | Fresh unit tests cover missing fields, invalid date, one-minor-unit tolerance, fractional quantities, precision. `money.ts:9–30`; `rules.ts:26–153`. | Extraction omissions above still limit end-to-end correctness. |
| Approved supplier identifiers and aliases | COMPLETE | `rules.ts:154–185`; fresh alias/unknown-ID/unapproved-supplier tests passed. No fuzzy name match establishes identity. | Alias governance is outside this read-only reference-data UI. |
| PO eligibility, supplier/currency matching, hard balance policy | COMPLETE | `rules.ts:188–245,260–281`; seeded split run blocked INR 10,000 excess; currency and precedence tests passed. | Recheck all mutable reference attributes at approval if reference editing is introduced. |
| Valid smaller partial invoice | COMPLETE | Real AUD-PARTIAL PDF for INR 20,000 accepted against INR 30,000 available; impact 2,000,000 minor units. `probes.json`. | None for tested case. |
| Explicit and ambiguous PO matching | COMPLETE | Two candidates, null chosen PO, NEEDS_REVIEW; E2E selected PO-2026-302 and re-evaluated to ready. `rules.ts:188–215`; E2E lines 77–95. | Changing a previously selected PO via correction is broken; A05. |
| Deterministic decisions and severity precedence | COMPLETE | Pure `rules.ts:18–306`, no model decision call; blocked > review > ready at lines 289–293. Fresh tests passed. | Extend regressions for extracted contradictions. |
| Duplicate file hash and normalized business key | COMPLETE | `service.ts:49,149–188`; `rules.ts:246–258`; renamed file blocked and linked original; DB tests cover changed bytes and business identity. | Historical commitment links are a separate usability limitation, not proof of a downloadable historical PDF. |
| Atomic cumulative reservations and repeated approval | COMPLETE | Inspected shared advisory transaction lock at `service.ts:125,226`, reservation delete/insert within transaction, unique keys in migration line 6. Real DB concurrency test: only one INR 60 request fits INR 100; repeated approval retains one reservation. | Lease ownership/revision fencing is a separate missing invariant; A01. |
| Reviewer correction preserves ordinary audit history | COMPLETE | Actual scan correction retained original null, corrected 11800.00, reason, timestamp, revision 2, generic workspace actor, and prior evaluation snapshot. `service.ts:286–330`; `probes.json`. | Individual authenticated identities are not recorded; shared identity is documented. |
| Corrections re-evaluate the intended PO | BROKEN | Corrected input PO-2026-302 while stored selection/evaluation stayed PO-2026-301 and ready. `service.ts:286–293`; `rules.ts:188`; A05. | Clear/reconfirm stale PO selection and re-evaluate dependencies. |
| Finalized review actions are immutable as documented | BROKEN | Approve followed by POST reject returned 200, changed review to rejected, and removed reservation. `service.ts:239–284`; A04. | Enforce transition policy on server, not only hidden UI controls. |
| Live stages from persisted backend execution | PARTIAL | Real timestamps/events, polling every 1.5 seconds (`workspace.tsx:179–206,903–939`), refresh recovery passed. No timer-driven fake stage progress. | Stage labels overstate work performed at that point, and exhausted recovery leaves running stages; A06/A09. |
| Dashboard history, counts, search/filter/pagination | COMPLETE | Stored records loaded by `service.ts:74–75`; computed counts/filter/slice `workspace.tsx:268–298`; browser search and mobile tables passed. | Pagination is client-side over full evidence snapshots; optimize for larger workloads. |
| History survives service restart | COMPLETE | Eight completed audit invoice snapshots were unchanged after stopping/restarting audit PostgreSQL, web, and worker. `restart-and-recovery.json`. | Persistence does not validate the correctness of every stored state. |
| Interrupted jobs recover and reuse extracted results | COMPLETE | Killed the real audit worker after actual OCR had been saved. Advanced only that audit lease to expiry, requeued through recovery service, restarted worker: completed with extraction skipped and exactly one extraction-running event. `crash-before.json`, `restart-and-recovery.json`. | A separate real two-worker pause/expire/resume test corrupted a finalized run; A01. Lease expiry was time-advanced rather than waited out. |
| Exhausted jobs reach coherent failed stage states | BROKEN | Attempts=3 expired audit job became invoice failed while extraction remained running and later stages queued. `service.ts:356–384`; A06. | Fail active stages and skip remaining stages transactionally. |
| Bounded transient provider retries and timeouts | PARTIAL | Inspected two-attempt loop and 120-second child timeout (`worker.ts:80–132`); job exhaustion and OCR-disabled error verified. | Actual timeout termination and both transient retry attempts were not forced; do not infer runtime proof from code alone. |
| Invalid type, size, corrupt/encrypted/over-page PDFs | COMPLETE | Fresh browser failure suite passed. Additional API probes: wrong extension 400, >10 MB 413, missing file 400; record count unchanged. | Malformed review JSON incorrectly returns 500; A08. |
| Provider unavailable versus business review | COMPLETE | OCR_PROVIDER=disabled on real scan failed with explicit setup guidance; malformed/encrypted documents fail execution; missing total completes with NEEDS_REVIEW. | Paid-provider behavior is inapplicable: no paid provider is configured. |
| Loading, empty, failure, retry and disconnection states | PARTIAL | Real offline/reconnect and retry controls inspected; loading/empty presentation verified using an explicitly mocked list response only. | Reconnect retains stale red “Failed to fetch” banner; A07. |
| Keyboard focus, contrast, status text and icons | COMPLETE | Fresh Axe checks passed on core/detail screens; manual Tab focus showed solid outline. CSS focus rules at `globals.css:42–46`; status text/icon component. | Full keyboard traversal and screen-reader audit not performed. |
| Responsive desktop/mobile browser experience | COMPLETE | Stock 393×851 browser test passed; additional invoice-detail check had scrollWidth=innerWidth=393 and review controls present. Screenshots inspected. | Physical Android/device browser is UNVERIFIED. |
| Private files and authorized original downloads | COMPLETE | UUID storage keys and mode 0600 outside public (`storage.ts:29–42`); authenticated file route. Fresh auth check: unauthorized page/PDF 401, valid credential 200, cross-origin mutation 403. | Workspace is shared; tenant isolation/roles are absent by design. |
| Public authentication requirement and server-side secrets | PARTIAL | Production local-auth configuration was rejected; Basic mode tested locally. `config.ts:17–28`, `auth.ts:7–30`, `proxy.ts:4–26`. | No authenticated HTTPS deployment verified; Docker context exclusions incomplete, A10. |
| Input validation and resource/rate limits | PARTIAL | Schema validation, upload limits, rendering pixel cap, child timeout and write throttling present. | Full review-body schema/JSON-error handling missing; actual timeout/resource stress not verified. |
| Parameterized persistence and restrained routine logs | COMPLETE | Drizzle/sql parameters inspected; actual worker log contains event/run IDs, not document text. | PostgreSQL/security infrastructure logging not audited beyond this local app. |
| Guarded demo reset | COMPLETE | Inspected `reset.ts:5–23`; invoked with production environment against isolated audit DB: refused before TRUNCATE. No reset executed against existing data. | Operator misconfiguration cannot be ruled out by naming guards alone. |
| Setup, migrations, worker and build | PARTIAL | Fresh audit DB migrations/seed, separate worker and production build/run succeeded. | Dependencies were reused through a node_modules symlink; a new npm ci install was not repeated. Cross-platform setup remains unverified. |
| Architecture, process map, business assumptions and runbook | COMPLETE | Files read and matched against code; explicit reservation/tolerance/duplicate policies exist. | Correct contradictory immutable-review claims after fixing A04; reconcile stage descriptions and finalization. |
| Five realistic sample inputs and fixture manifest | COMPLETE | All five PDFs processed, scan structure independently verified, reference JSON exists; manifest is not imported by runtime. | No broad real-world invoice corpus evaluation. |
| Maximum-five-minute demo plan/script | COMPLETE | `docs/demo-script.md:1–19` specifies a 4:45 schedule with happy and edge cases. | Actual timed rehearsal and final recording were not provided or performed. |
| Runnable external deployment link | MISSING | Repository/docs expose localhost only; `git remote -v` was empty; no remote deployment evidence supplied. | Prepare an authorized reviewer-accessible environment if required by the candidate guide. Do not publish without authorization. |
| Docker/Compose deployment | UNVERIFIED | Configuration exists, but `docker` is unavailable on the audit machine. | Build/run on a Docker host, fix A10 first, verify migrations, shared storage, OCR and HTTPS auth. |
| Original candidate-guide conformance | UNVERIFIED | File present but OS denied content access (EPERM). | Obtain readable guide and reconcile submission instructions. |

## 3. Issues ordered by importance

### A01 — P0: worker writes lack lease/revision fencing; finalized evidence can be overwritten

**Expected:** a stale or superseded worker cannot mutate an invoice after losing job ownership, after a correction, or after finalization. Extracted fields, evaluated inputs, reservation and revision must remain coherent.

**Actual:** `saveExtraction` accepts only invoice ID and extraction and unconditionally replaces current fields. Other worker mutations likewise lack an ownership token. Two distinct probes demonstrated the problem:

- **Service-level stale-write injection:** an approved corrected scan was passed its original extraction again. Review stayed approved, current total became null, and recommendation/evaluated total stayed READY_FOR_APPROVAL / 11800.00.
- **Actual two-worker race with accelerated lease expiry:** paused worker A during real OCR; expired its audit lease; let worker B recover, finish, process the verified 118.00 correction, and approve; stopped B and resumed A. Worker A read a result path already consumed/deleted by B (both attempts use the same job-ID filename), then changed the finalized run to **failed**, while review stayed **approved**, recommendation stayed **READY_FOR_APPROVAL**, and the 11800-minor-unit reservation remained. The field-overwrite variant was not reproduced through this race; it was established by the separate service injection. The late failure mutation was reproduced through real processes.

**Reproduce:** the temporary `stale-worker-race.ts` uploads the actual image-only `audit-stale-worker.pdf`, uses SIGSTOP/SIGCONT on the owned audit worker, advances only that test lease, starts a replacement worker, and performs correction/approval through the real API before resuming the original. Inspect invoice `8094486c-672c-41fc-8aea-72e7972d52c3`: it ends failed/approved/ready. The probe originally waited for a second completed state; the stale attempt instead failed. Its final state was independently fetched and recorded. The separate `recovery-probes.ts` records the direct stale field-write injection.

**Code/evidence:** `src/lib/service.ts:458–474`, unguarded failure mutations `413–443`, recovery/claim `335–410`; lease renewal `scripts/worker.ts:48–54`, shared temporary result path at line 80; `recovery-probes.json:staleWriteServiceInjection`; `stale-worker-race.json:finalObserved`.

**Impact:** stale executions can corrupt finalized data or processing state after another worker/reviewer has completed it. Severity is P0 for this demonstrated data-integrity failure. No unauthenticated exploit, double payment, or overcommit was demonstrated.

**Recommended fix:** give every claim an ownership/generation token and revision; require those values and a valid running lease for all worker mutations, including extraction save, stage changes, evaluation and completion. Reject stale writes atomically on success and failure paths, and use per-claim temporary result filenames. Turn the actual two-worker pause/expire/resume probe into a regression proving finalized state is unchanged by the old owner.

### A02 — P1: contradictory critical values can receive a ready recommendation

**Expected:** two different totals in the same invoice create explicit uncertainty and NEEDS_REVIEW, with both excerpts preserved.

**Actual:** a real labelled PDF containing subtotal 100.00, tax 18.00, **Total 118.00 and Total 1180.00** extracted the first total, emitted no warning, and became ready with a reservation.

**Reproduce:** upload `.data/audit-20261031/evidence/audit-conflicting-total.pdf`; inspect AUD-CONFLICT's document evidence, warnings, and recommendation.

**Code/evidence:** first-match return `src/lib/extraction.ts:18–38`; `probes.json:conflictingTotal`; screenshot `conflicting-total-ready.png`.

**Impact:** the system presents a definitive financial recommendation where the source itself is ambiguous. The narrow parser limitation does not justify automatic readiness for contradictory recognized labels.

**Recommended fix:** collect all candidate critical values with page/excerpt evidence, normalize them, and flag unresolved conflicts. Add an end-to-end real-PDF regression; corrected verified resolution should preserve the original conflict.

### A03 — P1: runtime extraction discards available line items and bypasses their checks

**Expected:** when item detail is visibly available, extract supported detail or explicitly require review if it cannot be safely interpreted. Only genuinely bundled charges should pass without line arithmetic.

**Actual:** a PDF with **Qty 2 × unit price 100.00 = amount 100.00** and reconciled footer 100+18=118 became ready. Its extracted lineItems was `[]`; the rule reported a bundled charge.

**Reproduce:** upload `audit-line-discrepancy.pdf` from the audit evidence directory. Inspect extracted text, empty lineItems and BUNDLED_CHARGE finding.

**Code/evidence:** `src/lib/extraction.ts:64–72` always sets `lineItems: []`; `src/lib/rules.ts:90–145`; `probes.json:lineItemMismatch`. Existing unit tests inject line items directly and therefore miss this integration gap.

**Impact:** business-rule coverage exists in isolation but is disconnected from real document evidence.

**Recommended fix:** support a bounded, documented line representation or detect unparsed item detail and route it to review. Add a real PDF where a line discrepancy prevents readiness while a true bundled invoice still passes.

### A04 — P1: reject API can reverse an approved invoice despite documented finalization

**Expected:** approved/rejected invoices follow the declared immutable-finalization policy, or an explicit authorized reversal workflow creates a new auditable financial transition.

**Actual:** approve a clean invoice, then POST reject with a reason: HTTP 200, review becomes rejected, reservation is deleted. UI hiding does not enforce the server invariant.

**Reproduce:** POST `{"action":"approve","reason":"Verified original invoice"}` to the clean invoice's review endpoint, then POST `{"action":"reject","reason":"Attempt after final approval"}`. Inspect reference commitments.

**Code/evidence:** reject branch `src/lib/service.ts:276–279` precedes finalized-state guard at `281–285`; UI finalization at `workspace.tsx:1257`; `probes.json:approvedThenRejected` shows no reservation.

**Impact:** financial commitments can be released through a transition the documented policy says is unavailable. This assessment makes no payment, so no actual payment reversal was tested.

**Recommended fix:** centralize permitted review transitions and enforce them before action-specific mutations. Add server/API tests for approve→reject, rejected→approve, repeated actions and concurrent finalization attempts.

### A05 — P1: corrected PO reference can be ignored in favor of a stale selection

**Expected:** correcting the purchase order changes the input used by the next evaluation, or requires explicit confirmation of a conflicting existing selection.

**Actual:** after selecting PO-2026-301 on the ambiguous invoice, correcting poReference to PO-2026-302 left `selectedPo` and evaluated PO at 301. Decision remained ready. A selected PO is not cleared when its dependent fields change, and the UI no longer exposes candidates once resolved.

**Reproduce:** process ambiguous sample → select 301 → correct extracted PO to 302 with a reason → rerun → compare fields.poReference, state.selectedPo, evaluation.poId.

**Code/evidence:** `src/lib/service.ts:286–293`; precedence `src/lib/rules.ts:188`; display `workspace.tsx:1008`; selector only for multiple candidates at `1269–1280`; `probes.json:stickyPO`.

**Impact:** a reviewer's verified correction can allocate to an unintended order.

**Recommended fix:** invalidate dependent manual selection when supplier/PO fields change; expose current selected PO and a clear/reselect action. Record selection provenance and test corrections following prior selection.

### A06 — P2: exhausted recovery leaves the timeline running forever

**Expected:** exhausted job → invoice failed, active stage failed, unstarted stages skipped, with an actionable retry state.

**Actual:** a seeded expired running job at attempt 3 became failed, but its extraction stage stayed running and subsequent stages stayed queued.

**Reproduce:** in a disposable DB create a running invoice/job with attempts=3 and expired lease, then call recoverJobs. This was a state-injection test of the recovery boundary, not three real 180-second waits.

**Code/evidence:** `src/lib/service.ts:356–384`, compared with normal failure stage handling at `425–431`; `recovery-probes.json:exhaustedRecovery`.

**Impact:** execution status and the supposedly authoritative live timeline disagree; elapsed time can continue increasing on a failed run.

**Recommended fix:** share a transactional terminal-stage transition between recovery exhaustion and normal failure; persist the resulting stage event and test the UI snapshot.

### A07 — P2: reconnect restores data but leaves a stale error banner

**Expected:** successful reconnect clears the connection error while retaining unrelated actionable errors.

**Actual:** offline browser showed the expected reconnect notice and “Failed to fetch”. After network restoration the reconnect notice disappeared, data refresh resumed, but the red “Failed to fetch” banner remained.

**Reproduce:** open detail → set browser context offline → wait for polling failure → restore online → wait for reconnect notice to disappear.

**Code/evidence:** `src/components/workspace.tsx:179–196` sets error on failure but not on recovery; `browser-probes.json` contains before/after notices.

**Impact:** reviewer sees a false continuing failure after recovery.

**Recommended fix:** separate network/read errors from review/upload errors, and clear the former on a successful refresh. Add offline/online browser assertions.

### A08 — P2: malformed review input is not consistently validated

**Expected:** malformed JSON and invalid optional fields receive an actionable 400 response without queuing a broken run.

**Actual:** POST body `{` returned HTTP 500 with a database/worker readiness message. The route validates action/reason types and fields, but not selectedPo's type/length as a whole request schema.

**Reproduce:** POST malformed JSON to a synthetic invoice review endpoint with valid same-origin headers. Malformed JSON failure is runtime-confirmed; the selectedPo schema gap is source-confirmed and was not separately exploited.

**Code/evidence:** `src/app/api/[...path]/route.ts:110–124,129–161`; `service.ts:290–293`; `probes.json:malformedJSON`.

**Impact:** ordinary input errors are misclassified as operational outages; malformed selection values can reach persistence/normalization.

**Recommended fix:** validate the whole body with an action-discriminated schema, handle JSON syntax errors as 400, and validate PO selection before enqueueing.

### A09 — P2: timeline stage labels do not accurately locate the checks

**Expected:** “Validate fields & arithmetic” and “Match vendor & purchase order” complete after those checks execute, with findings attached to their stages.

**Actual:** stage 3 only schema-parses fields; stage 4 loads records; arithmetic and matching actually execute together inside evaluateAndReserve during stage 5. “Save recommendation” mainly reads a recommendation already saved by stage 5.

**Reproduce:** inspect `worker.ts:163–220` against `rules.ts` and `service.ts:164–206`; compare observed stage messages in the detail screenshot.

**Code/evidence:** `scripts/worker.ts:163–220`; `src/lib/types.ts:59–66`.

**Impact:** progress is real and persisted, but its business semantics overstate which checks have finished. This is not timer-driven fake processing.

**Recommended fix:** align labels with actual operations or separate pure validation/matching/check results and persist findings at their genuine boundaries.

### A10 — P2 before deployment: Docker context excludes only two environment filenames

**Expected:** no environment/credential files enter the image; only the safe example is permitted.

**Actual:** `.dockerignore` excludes `.env` and `.env.local`, but not standard `.env.production`, `.env.production.local`, or other `.env.*` files. `COPY . .` would include those files if present. No real secret file was created, read, or sent, and Docker image behavior remains unverified because Docker is unavailable.

**Reproduce:** inspect `.dockerignore:4–5` and `Dockerfile:6`; on a Docker-equipped disposable checkout, use a harmless sentinel env file to verify context exclusion before deploying.

**Impact:** deployment using a common Next.js environment filename could embed secrets in the image/build context.

**Recommended fix:** exclude `.env*` and explicitly allow `.env.example`; use runtime secrets and test with a nonsecret sentinel.

### A11 — P3: all invoice evidence is repeatedly fetched for client-side pagination

**Expected:** larger histories use paginated summary rows; detail evidence is fetched only for the selected invoice.

**Actual:** every 1.5-second refresh requests all invoice JSON, including extraction text and historical evaluation snapshots, and pagination slices locally.

**Reproduce/code:** `service.ts:74–75`; `workspace.tsx:181–185,205,268–298`.

**Impact:** increasing latency, memory and payload size as invoice/revision counts grow; not a blocker for the small local demo.

**Recommended fix:** add bounded server-side summary pagination and targeted polling or event delivery. Keep this separate from the required integrity fixes.

## 4. Scenario results from new real-document runs

Initial state: newly migrated/seeded **invoicelens_audit** DB, no uploaded runs. For the five required scenarios, these were actual PDF uploads processed by the separate live worker on port 3010. Expectations were checked against observed fields/results rather than used by runtime code.

| Scenario/input | Expected | Observed | Balance/audit evidence |
| --- | --- | --- | --- |
| `happy-path.pdf` | Northstar; NS-2026-1042; date 2026-10-26; INR 23600; PO-2026-101; ready | **PASS:** PDF.js text, READY_FOR_APPROVAL. Run `293d5a7a-b385-4561-be42-51b41daaff98`. | One reservation. Later approve→reject was an additional defect probe, not the original happy-path result. |
| Same bytes as `duplicate-renamed.pdf` | Block, link original, no second allocation | **PASS:** BLOCKED; duplicateOf points to the original happy run. Run `b583899b-f3a3-4130-9975-38e619bf88c6`. | Stock browser test also asserted no duplicate commitment and earlier-invoice link. Changed-byte normalized business-key behavior passed DB tests. |
| `split-overbalance.pdf` | INR 100000 − INR 70000 = INR 30000; INR 40000 exceeds by INR 10000; block | **PASS:** BLOCKED, excess 1000000 minor units. Run `f1fc7e42-244a-4808-b17c-3452afd4a26b`. | Historical HIST-001 commitment included; no new commitment. Extra real INR 20000 partial invoice was ready with prior 7000000 and remaining 3000000 minor units before allocation. |
| `scan-missing-total.pdf` | Actual OCR; total unknown; review; verified correction reruns | **PASS:** zero text layer independently established; Tesseract output total null, NEEDS_REVIEW. Run `8472a381-e089-4306-a526-161773e841f8`. | Correct to 11800.00 → ready, revision 2; original extraction and previous null input retained, with reason/time/actor. Subsequent stale-write injection deliberately demonstrated A01. |
| `ambiguous-po.pdf` | Two candidates, no arbitrary selection; human choice reruns | **PASS:** NEEDS_REVIEW; candidates 301/302; poId null. Run `5415caa9-4ec1-4e4d-967d-c2d914ef060f`. | Stock browser test selected 302 and became ready. Additional 301→correct-to-302 probe exposed A05. |

Independent adversarial PDF results: **AUD-CONFLICT incorrectly ready**, **AUD-LINES incorrectly ready**. These are material failures even though all required synthetic scenarios and the existing suite pass. PDFs and full extracted text are retained with the audit artifacts.

## 5. Verification commands, outcomes and limits

Commands ran from the archived checkout, with the dedicated Node 22.23.4 tool directory on PATH. Mutating commands used exported `DATABASE_URL=<isolated audit DB URL>`, `APP_ENV=test`, `AUTH_MODE=local`, `APP_URL=http://127.0.0.1:3010`, `STORAGE_DIR=.data/audit-files`, and `NEXT_TELEMETRY_DISABLED=1`. Test-only local credentials are omitted here; no existing workspace credentials were needed.

| Exact command / check | New result | Evidence / qualification |
| --- | --- | --- |
| `git rev-parse HEAD`; `git status --porcelain=v1` | Commit above; initially clean | Original source checkout inspected. |
| `npm run db:migrate` | Exit 0; migrations applied | New audit database, no existing records reset. |
| `npm run db:seed` | Exit 0 | Synthetic reference records only. |
| `npm test` | **30 passed; 2 test files; exit 0; 798 ms** | `vitest.log`. Rules and real PostgreSQL transactions; structured fields are supplied directly, not extracted in these tests. |
| `npm run typecheck` | Exit 0 | `typecheck.log`. |
| `npm run lint` | Exit 0 | `lint.log`; no application lint fixes made. |
| `npm run build` | Exit 0; compiled, type-checked and generated production routes | `build.log`. Nested archived checkout caused a workspace-root warning; build still succeeded. Dependencies were reused, not freshly installed. |
| `npm run test:e2e` | **4 passed; exit 0; 39.0 s** | `playwright.log`. Production build, Chromium; real provider path. Its new invoicelens_e2e DB and .data/e2e-files were on the fresh audit cluster. |
| `npm run provider:check` | Exit 0 | Actual text PDF and actual Tesseract scan; correct invoice numbers; scan total null. `provider.log`. |
| `npm run smoke` | Exit 0; five real runs | `smoke.log`, scenario table above; all uploads were to the isolated live app. |
| `npm run auth:check` | Exit 0 | Temporary Basic-auth production-mode app on 3002; page/file access and cross-origin checks passed. `auth.log`. |
| `node --import tsx .data/audit-tools/probes.ts` | Completed; found A02–A05 and A08 | Additional real PDFs and API actions, not extraction mocks. `probes.json`. |
| `node .data/audit-tools/browser-probes.mjs` | Completed; found A07 | Real browser offline/online simulation, focus observation, 393px detail screenshot. |
| `node --import tsx .data/audit-tools/crash-probe.ts` | Real audit worker killed after real OCR persisted | Only the audit lease was advanced to expiry. No real 180-second wait was claimed. |
| `node --import tsx .data/audit-tools/recovery-probes.ts` | Found A01/A06; requeued interrupted run | Explicit service-level stale-write and exhausted-state injections, distinct from the actual race below. |
| `node --import tsx .data/audit-tools/stale-worker-race.ts` plus independent final-state read | **Reproduced stale finalization corruption**: completed/approved became failed/approved while ready recommendation and reservation remained | Actual worker pause, accelerated lease expiry, replacement worker, correction/approval, and old-worker resume. Shared extraction-result filename caused a stale ENOENT failure write. No extraction mock. |
| Stop/restart temporary audit PostgreSQL, web and worker; compare snapshots | **8 completed snapshots unchanged**; interrupted run completed, reused OCR | `restart-and-recovery.json`; one extraction-running event, later extraction stage skipped. Recovered invoice was correctly duplicate-blocked because its invoice identity was already present. |
| `OCR_PROVIDER=disabled node --import tsx scripts/extract.ts public/samples/scan-missing-total.pdf .data/audit-tools/disabled.json` | Expected nonzero exit, explicit OCR setup error | Actual scan; no substituted JSON result. |
| `node .data/audit-tools/boundary-probes.mjs` | Type 400, oversize 413, missing file 400; records 10 before/after | `boundary-probes.json`. |
| `APP_ENV=production AUTH_MODE=basic … node --import tsx scripts/reset.ts --confirm-demo-reset` | Expected refusal before destructive SQL | `reset-guard.log`; isolated DB only, no reset performed. |
| `APP_ENV=production AUTH_MODE=local … node --import tsx -e 'import("./src/lib/config.ts")'` | Expected configuration rejection | `config-guard.log`. |
| `node .data/audit-tools/ui-states.mjs` | Loading, empty and retry controls visible | Empty/loading presentation used a delayed mocked list response; no provider mocks and no server-data writes. |

### What these tests do and do not prove

- **Mocked extraction:** none used in this audit. Unit/DB tests inject typed Fields, so they do not prove extraction. The separate real document tests provide that evidence.
- **Real text extraction:** standard samples plus two adversarial PDFs and a valid smaller partial invoice were processed. Adversarial failures are reported, not hidden by the stock pass count.
- **Real OCR:** image-only fixture structure and rendering checked; actual Tesseract path executed, missing total remained unknown, correction worked on the ordinary path.
- **Browser emulation:** desktop Chromium and 393×851 viewport; additional invoice-detail, offline/reconnect, focus and screenshot checks. This is not physical Android verification.
- **Recovery:** actual worker termination, service restarts, and a real two-worker pause/expire/recover/approve/resume race were tested; lease time was advanced in the disposable DB. The real race changed finalized execution state to failed. The separate field-overwrite and exhaustion probes used explicit service/state injection. Actual 120-second extraction timeout termination remains **UNVERIFIED**.
- **Security:** local Basic/CSRF/file authorization and production config/reset guards tested. TLS, edge authentication rate limits, infrastructure policy, backup/restore and remote deployment were not tested.
- **Test quality:** concurrency tests assert reservations/amounts in an actual DB, and E2E asserts actual decisions, duplicate linkage and original evidence, which are meaningful. Coverage gaps include contradictory extracted values, visible unparsed lines, API final-state transitions, selected-PO invalidation, lease fencing, exhausted-stage coherence, and reconnect error cleanup. The newly observed failures show why test names and aggregate counts are not sufficient proof.
- **Fresh install/deployment:** no new npm ci install, Docker execution, physical-device test, authenticated HTTPS deployment, or timed five-minute rehearsal was performed. Docker is unavailable; candidate guide contents are OS-blocked. These checks remain unverified rather than assumed passing.

## 6. Submission readiness

| Submission item | Finding |
| --- | --- |
| Runnable reviewer-accessible link | **MISSING** remotely. Local app is runnable; no hosted assessment link was supplied. Whether the original guide mandates a specific link/access format is unverified. No publication was authorized or attempted in this audit. |
| Sample inputs and reference dataset | **Present and actually exercised.** Five PDFs, an actual raster-only scan, and public synthetic reference JSON. |
| Five-minute demo script | **Present**, planned at 4:45. Actual timed rehearsal/recording remains unverified; no finished video artifact was found in the tracked repository. |
| Reproducible local setup | **Mostly verified** through migrations/seed/build/run on a fresh audit database; dependencies reused. README correctly requires separate DB/app/worker terminals. Repeat npm ci on a clean machine before packaging. |
| Documented assumptions | **Present**, including reservation policy, zero balance tolerance, arithmetic tolerance, exact supplier aliases, duplicate identity, and shared reviewer. Correct the finalization mismatch and disclose extraction boundaries. |
| Original candidate guide | **UNVERIFIED** due EPERM. A readable copy is required before asserting final conformance. |
| Secrets/private data in delivery | Tracked files reviewed contain synthetic samples and a placeholder environment example; runtime files are ignored. No secret/private document was deliberately added. This is not an exhaustive historical secret scan of external systems. Fix Docker context exclusions before image delivery. |

## 7. Prioritized completion plan

### Required fixes and submission checks

1. **Protect the write invariants:** implement lease/revision fencing across worker mutations (A01), enforce final review transitions (A04), and invalidate/reconfirm stale PO selections after corrections (A05). Add regression tests that fail against this audited commit.
2. **Make extraction conservative where it is currently unsafe:** detect contradictory critical values (A02) and stop treating visible unparsed line detail as a clean bundled charge (A03). A bounded parser plus explicit review is sufficient; a new paid service is not required. Preserve all conflicting evidence.
3. **Correct recovery and reviewer feedback:** make exhausted stage states terminal (A06), clear recovered network errors (A07), validate entire review bodies (A08), and align live stage labels/results (A09). Re-run existing suites and new regressions with actual PDFs.
4. **Close submission evidence:** obtain a readable candidate guide, reconcile its instructions, perform a fresh npm ci setup rehearsal, time the demo under five minutes, and prepare the required reviewer-accessible link/video/access instructions. Public exposure or charges require separate authorization; none was performed here.
5. **Before any container/public run:** exclude all secret env filenames (A10), build/run Compose on a Docker host, verify authenticated HTTPS access, original-file authorization, OCR readiness, persistent shared storage and restart recovery there.

### Optional production hardening, separate from assessment fixes

- Individual user identity, role permissions, controlled administrative reversals/revisions and durable external audit retention.
- Object storage, retention/deletion policy, tenant isolation if needed, stronger process/resource isolation and a larger invoice-layout evaluation corpus.
- Distributed rate limits/login protection, operational metrics/alerts, backup/restore drills and server-side summary pagination (A11).
- Physical Android and full keyboard/screen-reader testing; broader OCR languages and production financial integration only after separate review.

**Final assessment:** the documented local demonstration works, and the implementation has real automation and meaningful tests. It should not be submitted as fully meeting the detailed specification until the integrity/extraction defects are resolved and the missing submission evidence is checked. No claim of production readiness is supported by this audit.
