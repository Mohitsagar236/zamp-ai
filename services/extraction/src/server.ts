import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractionSchema,
  API_VERSION,
} from "../../../packages/contracts/src/index.js";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { body, HttpError, send, serve } from "./http.js";
import { localProvider } from "./provider.js";
import {
  beginExtraction,
  completeExtraction,
  ExtractionConflict,
  EXTRACTOR_VERSION,
} from "./cache.js";
await mkdir(config.OCR_CACHE_DIR, { recursive: true, mode: 0o700 });
serve(
  async ({ req, res, path }) => {
    if (req.method !== "POST" || path !== "/v1/extractions")
      throw new HttpError(404, "Endpoint not found");
    const key = String(req.headers["idempotency-key"] ?? "");
    const hash = String(req.headers["x-content-sha256"] ?? "");
    if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(key) || !/^[a-f0-9]{64}$/.test(hash))
      throw new HttpError(
        400,
        "A valid idempotency key and SHA-256 digest are required",
      );
    const bytes = await body(req, config.MAX_FILE_MB * 1024 * 1024);
    if (
      bytes.length < 12 ||
      bytes.subarray(0, 5).toString() !== "%PDF-" ||
      createHash("sha256").update(bytes).digest("hex") !== hash
    )
      throw new HttpError(400, "Document signature or digest is invalid");
    const token = randomUUID();
    let operation;
    try {
      operation = await transaction((c) =>
        beginExtraction(c, key, hash, token),
      );
    } catch (error) {
      if (error instanceof ExtractionConflict)
        throw new HttpError(409, error.message);
      throw error;
    }
    if ("cached" in operation) {
      send(res, {
        apiVersion: API_VERSION,
        hash,
        extraction: operation.cached,
      });
      return;
    }
    const version = operation.version;
    const dir = await mkdtemp(join(tmpdir(), "invoicelens-pdf-"));
    const filename = join(dir, "source.pdf");
    try {
      await writeFile(filename, bytes, { mode: 0o600, flag: "wx" });
      let extracted;
      try {
        extracted = await localProvider.extract(filename);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/password|encrypted/i.test(message))
          throw new HttpError(
            422,
            "Encrypted PDFs are not supported. Upload an unlocked copy.",
          );
        if (
          /invalid pdf|pdf structure|xref|unexpected end|corrupt/i.test(message)
        )
          throw new HttpError(
            422,
            "PDF is corrupt or unreadable. Upload a valid PDF.",
          );
        if (/page limit|page dimensions/i.test(message))
          throw new HttpError(422, message);
        throw error;
      }
      const result = extractionSchema.parse(extracted);
      await transaction((c) =>
        completeExtraction(c, hash, version, token, result),
      );
      send(res, { apiVersion: API_VERSION, hash, extraction: result });
    } catch (e) {
      await pool
        .query(
          "UPDATE extraction_cache SET status='failed',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE hash=$1 AND lease_token=$2 AND extractor_version=$3",
          [hash, token, version],
        )
        .catch(() => {});
      if (e instanceof ExtractionConflict) throw new HttpError(409, e.message);
      throw e;
    } finally {
      await unlink(filename).catch(() => {});
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }
  },
  async () => ({
    ocr: config.OCR_PROVIDER,
    apiVersion: API_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void pool.end().finally(() => process.exit(0)));
