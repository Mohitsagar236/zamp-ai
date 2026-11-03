# Financial policy AP-2026.1

Money uses integer minor units (BigInt); INR/USD/EUR/GBP have 2 decimals, JPY 0, KWD 3. Unsupported currencies and extra nonzero decimals require review. The configurable arithmetic tolerance defaults to one minor unit. There is no PO balance tolerance and no implicit conversion.

Required: invoice number, valid date, supported currency, positive total. Subtotal plus tax must reconcile; absent details require review. Missing detailed line items are reported as not evaluated; they are not automatically classified as a verified bundled charge. The parser supports labelled scalar fields and explicit Description/Qty/Unit price/Amount tables, not arbitrary complex invoice layouts; inspect evidence before operational use.

Supplier matching: exact registered identifier or registered alias only. An unrecognized explicit identifier cannot be overridden by a similar name. Unapproved suppliers are blocked. PO must belong to the supplier, be open, and use the invoice currency. Missing PO: candidates need same supplier, currency, open status and sufficient remaining balance. Exactly one candidate may be selected automatically; multiple candidates require human selection.

Duplicate detection: original file SHA-256 plus canonical registered supplier and normalized invoice number (uppercase alphanumerics). Earlier runs are linked. Renaming never bypasses a hash match. Rejected invoices remain duplicate evidence; retry or correct the same record rather than reuploading. Historical commitments participate in identity checks. Ambiguous vendor identity cannot form a verified business key until corrected.

Ready recommendations reserve funds immediately. Reserved and approved invoices plus imported historical commitments count toward usage. Review, blocked and rejected invoices do not. Reevaluation replaces the same invoice's reservation; superseded revisions are audit evidence only. Rejection releases it. A PostgreSQL transaction advisory lock serializes all workspace financial evaluations and review mutations. The unique invoice reservation key and business identity index prevent double allocation. The available balance is rechecked inside that transaction. This favors correctness over multi-workspace throughput.

Precedence: any blocked check → BLOCKED; otherwise any review check → NEEDS_REVIEW; otherwise READY_FOR_APPROVAL. All findings are persisted. Execution failure is separate from a business decision. Ready is a recommendation, never a payment.

Reviewers may correct fields or select a PO with a reason, then all checks rerun. Approve is available only for a ready recommendation with an existing reservation; it does not allocate twice. Rejected/approved records are finalized and immutable through this assessment UI. Changes after finalization require an administrator revision workflow (not implemented). No generic override bypasses hard controls.

Invoices read using OCR require a reviewer to explicitly confirm all extracted values against the original scan in the correction form before they can be ready or approved. This is a review gate, not a confidence score; the parser does not verify whether absent line items represent a bundled charge. Existing OCR records must be reevaluated after verification.

## Company workspace safeguards — 1 November 2026

Production requires a recorded human check of invoice values, item details and tax treatment against the original for every invoice, including digital PDFs. Warnings and OCR also require source verification outside production. Corrections reset this attestation unless the reviewer explicitly checks it again; the reason and before/after values remain in history. A failed integrity or unresolved reconciliation check prevents approval. Unsupported item tables, tax-inclusive text, conflicting totals and ambiguous monetary grouping are exposed for review. A manual source check is not a measured extraction-accuracy guarantee.
