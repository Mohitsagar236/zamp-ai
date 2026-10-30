# Implementation plan and acceptance criteria
1. Establish typed input, private file storage, PostgreSQL migrations and documented financial policy.
2. Implement a vertical slice using actual PDF.js text extraction and Tesseract OCR, deterministic rules, and persisted evidence.
3. Add leased PostgreSQL jobs, persisted stage events and reconnectable live status.
4. Build responsive dashboard, upload, detail/review, records and policy screens.
5. Generate five real PDF scenarios; validate rules, transactional reservations and review flows with unit, database and browser tests.
6. Verify production build and local demonstration; document results honestly.

Acceptance: a real uploaded PDF leads to a durable recommendation; scans use OCR; duplicates cannot reserve twice; PO locks prevent concurrent overspending; corrections retain original evidence; failures are visible; refresh and restart retain runs. No publication or paid services.
