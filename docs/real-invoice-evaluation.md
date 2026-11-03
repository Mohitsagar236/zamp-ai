# Authorized invoice evaluation protocol

Real-invoice performance is **UNVERIFIED**. The synthetic regression set contains four fixtures. A separately reported public Portuguese invoice/receipt evaluation has now been executed; see [public-invoice-evaluation.md](public-invoice-evaluation.md). It does not validate the supported English scope or company PO matching. Do not add private documents to the repository or upload them to an external provider. The `evaluate:authorized` command reads local PDFs and labels, uses the same PDF.js/Tesseract provider and deterministic Decision rules as the application, and writes a local report. It does not call the application gateway, store the invoices in a database, or make financial commitments.

## Dataset to prepare

Use an access-controlled directory outside the repository. Obtain written authorization for evaluation, de-identify the copies, and retain an internal source-to-pseudonym map separately. Use pseudonymous IDs in the manifest. Capture each PDF's SHA-256 and an exact local reference snapshot (approved vendors, PO IDs/currencies/status/limits, and opening/current commitments) from the policy owner. Decision routing depends on that snapshot, so synthetic references cannot substantiate real-data routing performance.

For the proposed study, collect at least 200 invoices, with the final counts and category mix approved by the AP/product owners. Cover the actually supported input boundary:

- English, label-based digital PDFs with one page and multiple pages.
- English image-only scans with readable/high-quality and marginal/low-quality examples, plus mixed text/image pages where available.
- Every intended supported currency: INR, USD, EUR, GBP, JPY and KWD; include currency-appropriate decimal precision.
- Independently labeled missing or unreadable supplier, invoice number, date, currency, PO reference, subtotal, tax and total cases, including ambiguous date and money formats that must route to review.
- Suppliers and layouts separated in reporting; do not let repeated pages from one supplier stand in for layout diversity.

Do not treat multilingual, handwritten, arbitrary-column, line-item-heavy or otherwise unsupported documents as a supported category. They may be included as explicitly labeled negative cases to confirm they are rejected or sent to human review.

Two AP reviewers label every expected critical field and expected review-routing outcome independently before looking at parser output. Use `null` for absent or unreadable fields. Resolve every disagreement with an adjudication note and the agreed expected value. Preserve both original labels. Labels should cover supplier name/ID, invoice number/date, PO reference, currency, subtotal, tax, total, and whether a trained reviewer must check the document before approval.

## Manifest and reference snapshot

Create `<private-dataset>/labels.json` with this shape; the string values below are placeholders, not labels:

```json
{
  "provenance": {
    "authorizedBy": "approved evaluation owner or ticket ID",
    "consented": true,
    "deidentified": true,
    "labeledAt": "2026-11-01"
  },
  "referenceFile": "references.json",
  "entries": [
    {
      "id": "pseudonymous-001",
      "file": "pdfs/pseudonymous-001.pdf",
      "sha256": "<64 lowercase hex characters>",
      "category": "digital-single-page-INR",
      "layout": "digital-single-page-labels",
      "scanQuality": "not-applicable",
      "currency": "INR",
      "missingField": null,
      "critical": [
        "supplierName",
        "invoiceNumber",
        "invoiceDate",
        "currency",
        "total"
      ],
      "labels": {
        "reviewerA": {
          "supplierName": "<expected>",
          "supplierId": null,
          "invoiceNumber": "<expected>",
          "invoiceDate": "2026-10-21",
          "poReference": "<expected>",
          "currency": "INR",
          "subtotal": "100.00",
          "tax": "18.00",
          "total": "118.00"
        },
        "reviewerB": {
          "supplierName": "<expected>",
          "supplierId": null,
          "invoiceNumber": "<expected>",
          "invoiceDate": "2026-10-21",
          "poReference": "<expected>",
          "currency": "INR",
          "subtotal": "100.00",
          "tax": "18.00",
          "total": "118.00"
        },
        "expected": {
          "supplierName": "<agreed expected>",
          "supplierId": null,
          "invoiceNumber": "<agreed expected>",
          "invoiceDate": "2026-10-21",
          "poReference": "<agreed expected>",
          "currency": "INR",
          "subtotal": "100.00",
          "tax": "18.00",
          "total": "118.00"
        },
        "reviewerAReview": true,
        "reviewerBReview": true,
        "expectedReview": true,
        "adjudicationNote": "Required when reviewers disagree."
      }
    }
  ]
}
```

Every supported field must be present in each of `reviewerA`, `reviewerB` and `expected`; a missing field is explicitly `null`. `references.json` uses the `vendors`, `pos` and `commitments` arrays returned by the authorized reference snapshot, including the real approved PO balances. Keep both files and PDFs outside Git. The evaluator rejects document paths that escape the dataset directory, verifies every PDF hash, refuses unresolved independent-label disagreements, and evaluates each PDF locally.

## Run and report

From the repository root, after setting up the local English OCR cache as needed:

```sh
npm run evaluate:authorized -- /secure/invoicelens-study/labels.json /secure/invoicelens-study/report.json
```

The report contains critical-field accuracy and errors, the count of incorrect critical values that Decision would mark ready without review, review-routing rate, agreement with independently labeled routing outcomes, processing failures, and breakdowns by category, layout, scan quality, currency and missing-field case. Preserve the immutable input hashes, label versions, report, code revision, Node version and OCR model version with the study record. Route processing failures and any accepted critical error for adjudication; do not remove them from the denominator.

The tool uses the configured local English Tesseract engine for scanned pages and may download its language model on first use. Perform that download only from this authorized evaluation environment, then retain the model cache for repeatability. No invoice is sent to an external service. Secure and delete temporary copies and reports under the data owner's approved retention policy.

## Proposed controlled-pilot acceptance criteria

These are proposals for product-owner and AP policy-owner agreement, not declared targets or measured results:

- No critical-field error in the validation set is eligible for approval without human review; ambiguous, missing and OCR-derived values remain review-gated.
- The owners approve the supported layouts, scan-quality boundary, currencies, missing-field policy, study size/category minimums and handling of unsupported documents.
- They approve an acceptable measured critical-field accuracy and review-routing workload after seeing the category-level results; this document does not invent either threshold.
- Every processing failure is explained or corrected and rerun. Duplicate/retry and interrupted-job checks complete without lost review history or duplicate commitments.
- The isolated Compose deployment and full restore drill pass, and a named operator and AP reviewer sign off on access, monitoring, retention, backup and incident procedures.
- The pilot begins with a limited, explicitly authorized cohort and human verification against each original document; any move to automated approval requires a separate decision and evidence.

The product owner must decide which currencies and supplier/layout categories are in scope, whether the proposed 200-document study is sufficient, the minimum accuracy/routing thresholds, the maximum tolerable manual-review rate, whether any fields may ever be auto-approved, pilot duration/cohort, retention, and who can authorize data use. Until these decisions and the representative labeled dataset exist, real-world accuracy and controlled-pilot suitability remain **UNVERIFIED**.

## Current production review policy

Production requires source verification for every invoice, including apparently clean digital PDFs. Label review expectations against that policy; all current production inputs initially require a human check. A zero ungated-error count under this policy is a safety-gate result, not proof of accurate automatic extraction. The authorized evaluator has an isolated synthetic contract test for real PDF extraction, label completeness and report metrics; no company-authorized representative run has been completed.
