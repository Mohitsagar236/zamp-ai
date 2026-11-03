import { config } from "./config.js";
import { createHash } from "node:crypto";
export class WorkflowError extends Error {
  constructor(
    public status: number,
    message: string,
    public response?: unknown,
  ) {
    super(message);
  }
}
type Opt = {
  method: "GET" | "POST";
  correlationId: string;
  idempotencyKey?: string;
  json?: unknown;
  bytes?: Uint8Array;
  hash?: string;
  filename?: string;
};
export async function call<T = unknown>(
  service: "decision" | "extraction",
  path: string,
  o: Opt,
): Promise<T> {
  const base =
      service === "decision" ? config.DECISION_URL : config.EXTRACTION_URL,
    token =
      service === "decision" ? config.DECISION_TOKEN : config.EXTRACTION_TOKEN;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const headers: Record<string, string> = {
        Authorization: "Bearer " + token,
        "X-Correlation-ID": o.correlationId,
      };
      if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey;
      if (o.json) headers["Content-Type"] = "application/json";
      if (o.bytes) {
        headers["Content-Type"] = "application/pdf";
        headers["X-Content-SHA256"] =
          o.hash ?? createHash("sha256").update(o.bytes).digest("hex");
        headers["X-Filename"] = o.filename ?? "document.pdf";
      }
      const response = await fetch(base + path, {
        method: o.method,
        headers,
        body: o.bytes
          ? Buffer.from(o.bytes)
          : o.json
            ? JSON.stringify(o.json)
            : undefined,
        signal: AbortSignal.timeout(service === "extraction" ? 135000 : 5000),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data as T;
      if (![409, 429, 502, 503, 504].includes(response.status) || attempt === 3)
        throw new WorkflowError(
          response.status,
          data.error ?? "Internal service request failed",
          data,
        );
    } catch (e) {
      if (e instanceof WorkflowError) throw e;
      if (attempt === 3)
        throw new WorkflowError(
          503,
          service + " service is unavailable; workflow will retry.",
        );
    }
    await new Promise((r) => setTimeout(r, Math.min(4000, 300 * 2 ** attempt)));
  }
  throw new WorkflowError(503, "Internal service unavailable");
}
