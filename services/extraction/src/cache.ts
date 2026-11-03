import type { PoolClient } from "pg";
import {
  extractionSchema,
  API_VERSION,
  type Extraction,
} from "../../../packages/contracts/src/index.js";
export const EXTRACTOR_VERSION = "layout-parser/3.0";
export class ExtractionConflict extends Error {}
/** Caller supplies a transaction. Operation binding and lease acquisition are atomic. */
export async function beginExtraction(
  c: PoolClient,
  key: string,
  hash: string,
  token: string,
  version = EXTRACTOR_VERSION,
): Promise<{ cached: Extraction } | { version: string }> {
  // Serialize the same operation even when competing requests specify different hashes.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  const old = await c.query(
    "SELECT hash,extractor_version FROM extraction_operations WHERE idempotency_key=$1",
    [key],
  );
  if (old.rowCount && old.rows[0].hash !== hash)
    throw new ExtractionConflict(
      "Idempotency key was reused for another document",
    );
  if (old.rowCount) {
    const previous = await c.query(
      "SELECT result FROM extraction_results WHERE hash=$1 AND extractor_version=$2",
      [hash, old.rows[0].extractor_version],
    );
    if (previous.rowCount)
      return { cached: extractionSchema.parse(previous.rows[0].result) };
    // No result was committed. An interrupted operation can resume with the current provider.
  }
  await c.query(
    "INSERT INTO extraction_cache(hash,api_version,status,extractor_version) VALUES($1,$2,'queued',$3) ON CONFLICT DO NOTHING",
    [hash, API_VERSION, version],
  );
  await c.query(
    "INSERT INTO extraction_operations(idempotency_key,hash,api_version,extractor_version) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO UPDATE SET extractor_version=EXCLUDED.extractor_version",
    [key, hash, API_VERSION, version],
  );
  const state = await c.query(
    "SELECT status, lease_until > now() AS leased FROM extraction_cache WHERE hash=$1 AND extractor_version=$2 FOR UPDATE",
    [hash, version],
  );
  const cached = await c.query(
    "SELECT result FROM extraction_results WHERE hash=$1 AND extractor_version=$2",
    [hash, version],
  );
  if (cached.rowCount)
    return { cached: extractionSchema.parse(cached.rows[0].result) };
  if (state.rows[0].status === "running" && state.rows[0].leased)
    throw new ExtractionConflict(
      "Identical document extraction is already in progress",
    );
  await c.query(
    "UPDATE extraction_cache SET status='running',lease_token=$3,lease_until=now()+interval '130 seconds',updated_at=now() WHERE hash=$1 AND extractor_version=$2",
    [hash, version, token],
  );
  return { version };
}
export async function completeExtraction(
  c: PoolClient,
  hash: string,
  version: string,
  token: string,
  result: Extraction,
) {
  const owned = await c.query(
    "SELECT 1 FROM extraction_cache WHERE hash=$1 AND extractor_version=$2 AND lease_token=$3 AND status='running' AND lease_until > now() FOR UPDATE",
    [hash, version, token],
  );
  if (!owned.rowCount)
    throw new ExtractionConflict(
      "Extraction lease expired; retry with the same idempotency key",
    );
  if (result.version !== version)
    throw new Error(
      "Extractor result version does not match its cache identity",
    );
  await c.query(
    "INSERT INTO extraction_results(hash,api_version,extractor_version,result) VALUES($1,$2,$3,$4)",
    [
      hash,
      API_VERSION,
      version,
      JSON.stringify(extractionSchema.parse(result)),
    ],
  );
  await c.query(
    "UPDATE extraction_cache SET status='completed',provider=$4,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE hash=$1 AND extractor_version=$2 AND lease_token=$3",
    [hash, version, token, result.provider],
  );
}
