# Five-minute demo script (4:45 target)

Prepare with demo-runbook.md. Keep a clean demo reset, warmed OCR cache, web and worker running. Record at a desktop viewport. Do not add artificial delays.

**0:00–0:25 — Business problem.** “Accounts payable needs more than text extraction. InvoiceLens checks each invoice against the supplier, purchase order, duplicates and funds already committed. Every recommendation has evidence; nothing here makes a payment.” Show overview and reference records.

**0:25–1:15 — Clean invoice.** Upload → A clean invoice → Process sample. Show persisted stages while the real worker executes. Open original PDF. Point to supplier match, subtotal + tax, PO currency and available balance. “This ready recommendation reserves INR 23,600 transactionally so the next invoice sees the updated balance.”

**1:15–2:00 — Changed filename duplicate.** Upload → Same invoice, new filename → Process sample. “Renaming is not a new invoice. The hash and supplier/invoice identity link it to the original.” Show BLOCKED, earlier-invoice link, zero additional impact, and no approve button.

**2:00–2:45 — Cumulative balance.** Process A PO at its limit. Show INR 100,000 limit, INR 70,000 prior approved milestone, INR 30,000 available and INR 40,000 requested. “That INR 10,000 excess is a hard control. Arithmetic rounding tolerance never increases spending authority.”

**2:45–3:45 — Human review.** Process the scanned sample. Show OCR provider, original image, missing total, and review recommendation. Explain that this is an actual image-only PDF. Correct total to 11800.00 with reason “Verified supplier copy total in demo”; save and rerun. Original extraction remains null in evidence, corrected value is recorded separately. Recommendation becomes ready. In a real workflow the supplier copy must actually be verified; the exercise's stated correction is only demo evidence.

**3:45–4:20 — Ambiguity and audit.** Process Two possible purchase orders. Show both candidate orders with their descriptions in the selector. Select PO-2026-302 and give reason “Confirmed website design order in demo”; rerun. Explain that the system does not choose arbitrarily. Show revision audit.

**4:20–4:45 — Close.** Return to overview; refresh. “History and evidence survive leaving the page and restarting services. The worker recovers interrupted jobs, financial rules are deterministic, and concurrent reservations cannot overcommit a PO. This assessment uses a conservative English label parser and one private workspace; unfamiliar layouts need verification.”

If time is short: fully demonstrate clean + duplicate in the video and use the balance/scan/ambiguous runs prepared before recording for brief walkthroughs. For live interview, process each remaining sample from a fresh reset in the order above and inspect its findings. Never represent prepared runs as currently executing.
