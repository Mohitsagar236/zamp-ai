# InvoiceLens UI/UX review

## Skills and visual direction

Read and applied **frontend-design**, supplied at `/Users/mohitsagar/Desktop/code/zamp/SKILL.md`, and **imagegen**, `/Users/mohitsagar/.codex/skills/.system/imagegen/SKILL.md`. Imagegen used the built-in tool, not the API/CLI. Its output is a visual reference, not runtime UI or evidence of invoice decisions. The exact prompt is in `docs/ui-ux/imagegen-prompt.txt`; selected reference in `docs/ui-ux/design-reference.png`.

The design is a financial review desk. Tokens: navigation `#12233f`, action blue `#235bcc`, text `#1b2940`, secondary text `#5c6b80`, workspace `#f3f6fa`, surface `#ffffff`. Status colors are reserved for their meanings. Local type stack: Aptos / Segoe UI / Helvetica Neue / system sans; tabular numerals for money, 14–15px body text, 30px page titles, sentence-case labels. No font downloads or analytics.

Layout: a compact navigation rail, task heading and action, inline counts, exception cue, and a readable ledger. Detail puts the document alongside the fields and review controls, with recommendation and execution shown separately. Mobile uses stacked invoice summaries and a direct original-document link.

Plan review against the brief: the earlier design fragmented the workflow into decorative cards, small text and repeated labels. The revised plan prioritizes the ledger and original document, reserves panels for genuine groups, removes marketing content, and uses only actions backed by existing endpoints. The generated reference's invented dates/reasons and unsupported bulk controls are not implemented; actual records supply all UI values.

## Main problems observed before editing

- Small, low-emphasis labels and narrow invoice columns made reading and scanning harder.
- Execution, recommendation, and human review needed a clearer hierarchy.
- Upload selection immediately submitted, without a stable selected-file review step.
- Review corrections, original values and candidate evidence were difficult to compare.
- Financial actions lacked a review/confirmation step.
- Reconnected polling could leave a stale error banner.
- Mobile tables wrapped invoice identities and hid important outcomes in horizontal scrolling.

## Implemented screens and flows

- **Workspace and dashboard:** consistent navigation, skip link, visible focus, actual counts with working filters, search, pagination, aligned currency values, desktop ledger and mobile summaries. Execution, recommendation and human review are separate. No mixed-currency money aggregate.
- **Upload:** keyboard file picker and drag/drop, selected filename and size, explicit upload action, PDF/size validation, associated errors, loading/disabled controls and a synchronous guard against repeated requests. Synthetic sample actions are clearly identified and still upload real PDFs.
- **Processing:** persisted backend stage states, actual timestamps and elapsed durations, understandable stage titles, expandable execution evidence, failure/retry controls and a reconnect notice that clears after recovery. The existing 1.5-second polling mechanism and all event/API endpoints remain intact. No percentages or fabricated progress.
- **Review detail:** automated recommendation and reasons first; local PDF.js canvas preview alongside fields at desktop width, page navigation, hide/show and a direct original-document link. At narrow widths the direct link replaces the preview. Vendor evidence, PO limit/prior commitments/available balance/invoice impact, passed checks and exceptions, original extraction and audit history remain available.
- **Human review:** corrections show original values and field validation, PO candidates compare descriptions and balances, required reasons stay with the action, reevaluation outcomes are announced once, and approve/reject require confirmation. Native dialogs contain focus, support Escape and return focus to their trigger. Confirmation starts on the cancel action. Finalized reviews show recorded status without editable review actions.
- **References and policy:** clearer supplier/PO tables, commitments and balances, plain-language policy and processing readiness; technical configuration is disclosed separately. Existing safeguarded CLI demo reset remains outside normal review controls.

## Files and dependencies

`src/components/workspace.tsx` now handles routing, fetching and mutations, with presentation split into `src/components/invoice-ui/{overview,upload,detail,corrections,document-preview,references-policy,ui,presentation}`. `src/app/globals.css` contains the shared tokens, component states and responsive layouts. `tests/e2e/workflows.spec.ts` preserves the existing financial assertions and adds coverage for changed interactions.

No API, database, worker, financial-rule or security implementation changed. No dependency or lockfile changes. The browser preview reuses installed PDF.js; its version-matched, unmodified worker and license are served from `public/vendor/`, excluded from application lint in `eslint.config.mjs`. See its README for upgrade instructions. Document response security headers remain unchanged. No externally loaded fonts, imagery, analytics or CDN worker.

## Verification results

Verified on 31 October 2026 against the production build:

| Check | Result |
| --- | --- |
| `npm test` against a separate migrated unit-test database | 30 tests passed |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm run test:e2e` | 7 tests passed, final run 32.1 seconds |
| `git diff --check` | Passed |

Browser workflow tests processed real clean, duplicate, over-balance, scanned and ambiguous-PO PDFs. Verified PDF.js versus Tesseract extraction, refresh persistence, missing-total correction with original extraction retained, PO selection and reevaluation, duplicate/balance blocking, audit revision, approval confirmation and recorded approval. Invalid content, encrypted/corrupt PDFs, page limits and existing authorization boundaries remained covered. A repeated-click test observed exactly one upload POST. Reconnection cleared its notice while retaining typed review text.

Chromium browser checks covered all main routes at **390, 768 and 1440 CSS pixels**, with no page-wide overflow. Screenshots were inspected and the blank native PDF embed was replaced with a working local renderer. A separate two-page synthetic PDF verified next/previous and preview hide/show. Additional keyboard checks exercised correction-dialog containment, Escape and focus restoration; reject-confirmation cancellation; approval cancel focus and reopening. Search no-results and reduced-motion preference were exercised. A 720-CSS-pixel viewport checked the layout equivalent of a 1440px desktop at 200% zoom; actual browser zoom was not driven.

Axe checks using WCAG 2 A/AA, 2.1 AA and 2.2 AA tags found **zero violations** on dashboard, upload, references, policy and invoice detail, plus the open correction dialog. These automated results and keyboard checks are not a claim of WCAG compliance. Supporting browser notes: [browser-review.json](ui-ux/browser-review.json).

Financial tests used isolated databases on a separate local PostgreSQL instance. The existing demo database was not reset. Screenshot documents were checked against the bundled synthetic PDF hashes before capture.

## Screenshots and generated reference

| Screen | Before | After |
| --- | --- | --- |
| Dashboard, 1440px | [Before](ui-ux/before-overview.png) | [After](ui-ux/after-overview.png) |
| Upload, 1440px | [Before](ui-ux/before-upload.png) | [After](ui-ux/after-upload.png) |
| Invoice detail, 1440px | [Before](ui-ux/before-detail.png) | [After](ui-ux/after-detail.png) |
| Reference records | — | [After](ui-ux/after-records.png) |
| Policy and readiness | — | [After](ui-ux/after-policy.png) |
| Correction dialog | — | [After](ui-ux/after-corrections.png) |
| Dashboard, 390 / 768px | — | [390](ui-ux/after-overview-390.png), [768](ui-ux/after-overview-768.png) |
| Upload, 390 / 768px | — | [390](ui-ux/after-upload-390.png), [768](ui-ux/after-upload-768.png) |
| Detail, 390 / 768px | — | [390](ui-ux/after-detail-390.png), [768](ui-ux/after-detail-768.png) |

The mobile screenshots are full-page captures; the fixed bottom navigation appears at the original viewport edge. Browser verification used Chromium emulation, not a physical Android device.

Image generation: built-in `image_gen.imagegen`, one desktop reference with an opaque background. Exact prompt: [imagegen-prompt.txt](ui-ux/imagegen-prompt.txt). Selected output copied into [design-reference.png](ui-ux/design-reference.png); original tool output was `/Users/mohitsagar/.codex/generated_images/01a18ea4-c4f9-71c3-a3b9-6890648dd588/exec-eed6d34e-682f-4dcd-8591-199d0822f51e.png`. It is a design artifact only and is not loaded by the application.

## Remaining limitations

- Existing backend findings in [audit-report.md](audit-report.md), including stale-worker fencing and financial/review invariants, remain unresolved in this UI-focused change. Hiding finalized review actions is a UI safeguard; it does not repair API transition rules.
- No physical mobile device, Safari/Firefox, assistive-technology session or full accessibility audit was performed. The embedded canvas is a visual preview, without a selectable PDF text layer; extracted source text and the original-document link remain available. Advanced fonts/scripts and every possible PDF variant were not exhaustively tested.
- The preview worker must stay aligned with the pinned PDF.js version. Browser polling preserves the existing live-state behavior rather than adding a new transport.
- Tablet detail stacks the original document above the field/review columns; desktop provides the side-by-side review layout.
