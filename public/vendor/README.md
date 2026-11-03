# PDF preview worker

`pdf.worker.min.mjs` is the unmodified browser worker from the installed
`pdfjs-dist@6.4.299` dependency. Its Apache 2.0 license is included alongside it.
The document preview loads it locally; no CDN or external document service is used.

When upgrading `pdfjs-dist`, copy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs`
here again so the client and worker versions stay aligned, and verify a document
preview and page navigation. Vendored code is excluded from application linting.
