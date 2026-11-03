# Public invoice evaluation — 1 November 2026

The user authorized public datasets because no company dataset is available. We selected the publisher-hosted [Dataset of invoices and receipts including annotation of relevant fields](https://zenodo.org/records/6371710), by Francisco Cruz and Mauro Castelli (2022), DOI `10.5281/zenodo.6371710`. The publisher describes real private-company Portuguese invoices/receipts and provides field transcriptions. The record's API reports **CC BY 4.0**. Attribution and source metadata are retained locally. This is not an English vendor-invoice benchmark.

The local run used the first 20 images in the publisher archive order, without choosing examples based on extraction output. The original image bytes were embedded into PDFs for the application's real PDF.js/Tesseract path. Expected fields came only from the publisher's separate annotations, never from parser output. Original images and labels remain under `.data/public-benchmark/portuguese-6371710`, outside version control. No source document was uploaded to any provider. The annotation archive's publisher MD5 and each streamed image member's ZIP CRC were checked; the complete 410 MB image archive was not downloaded or verified as a whole. Every extracted original image has a SHA-256 recorded in the manifest.

| Metric                                          | Observed result                                          |
| ----------------------------------------------- | -------------------------------------------------------- |
| Documents                                       | 20                                                       |
| Category                                        | Portuguese invoice/receipt photographs, quality ungraded |
| Scored publisher-labeled fields                 | 84                                                       |
| Correct fields                                  | 0 / 84                                                   |
| Missing fields                                  | 84 / 84                                                  |
| Incorrect nonempty fields                       | 0                                                        |
| Incorrect values eligible without source review | 0                                                        |
| Source-review routing                           | 20 / 20                                                  |
| Processing failures                             | 0 / 20                                                   |

**This is failed extraction on an unsupported language, not production-accuracy evidence.** Zero ungated errors reflects the production policy requiring source verification for every invoice. The corpus lacks an approved company vendor/PO/commitment snapshot; financial matching accuracy was not evaluated. Missing publisher annotations are unscored, not labeled absent. Category, language and scan-quality metadata are in the report; currency and item-level ground truth are not available from this adapter. The publisher labels are independent of the application, but they are not two separately adjudicated AP reviews. No accuracy threshold or successful pilot claim is inferred.

Reproduce locally:

```sh
npm run prepare:public -- .data/public-benchmark/portuguese-6371710 20
npm run evaluate:public -- .data/public-benchmark/portuguese-6371710/public-labels.json .data/public-benchmark/portuguese-6371710/report.json
```

The preparation script streams a bounded subset rather than requiring the whole image archive. Reports capture parser/provider/contract source hashes, runtime version, original-image and generated-PDF hashes, per-document errors, routing, failures and category totals. The committed aggregate is [public-evaluation-results.json](public-evaluation-results.json); it contains no original documents or transcribed invoice values.

Next evidence required: suitably licensed real English vendor invoices covering intended layouts, scans, currencies and missing-field cases; independently checked labels; the actual company's approved procurement snapshot; and agreed acceptance thresholds. The [authorized evaluation protocol](real-invoice-evaluation.md) remains the pilot gate. Public documents do not supply trustworthy company purchase orders or authorize business commitments.
