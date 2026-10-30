# Process map
PDF upload → signature/size validation → private file + invoice + durable job → worker claims lease → inspect file → PDF.js page text (Tesseract OCR when inadequate) → schema validation → reference records → deterministic rules + duplicate identity + transactional balance reservation → persisted recommendation and audit → dashboard/detail.

Actual stage states: queued, running, completed, failed, skipped. Events and snapshot survive refresh. The UI polls stored state (no simulated progress). Workers heartbeat and extend leases; expired jobs resume up to 3 attempts. Saved extraction is reused across retry/correction. Invalid documents fail execution. Missing values produce successful execution with a review recommendation.

Human flow: inspect original PDF and extracted text → enter correction or choose PO with reason → enqueue reevaluation → replace reservation atomically if ready → approve or reject with reason. No payment is executed.
