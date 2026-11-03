import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  correlationId: string;
};
export const log = (
  event: string,
  correlationId: string,
  extra: Record<string, unknown> = {},
) =>
  console.log(
    JSON.stringify({ service: config.SERVICE, event, correlationId, ...extra }),
  );
export async function body(req: IncomingMessage, max = 32000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "Request too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(req: IncomingMessage, max = 32000) {
  try {
    return JSON.parse((await body(req, max)).toString());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Invalid JSON request");
  }
}
export function send(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}
export function serve(
  handler: (ctx: Context) => Promise<void>,
  ready?: () => Promise<unknown>,
) {
  const server = createServer(async (req, res) => {
    const incoming = String(req.headers["x-correlation-id"] ?? "");
    const correlationId = /^[a-zA-Z0-9._:-]{1,100}$/.test(incoming)
      ? incoming
      : randomUUID();
    res.setHeader("X-Correlation-ID", correlationId);
    const path = (req.url ?? "/").split("?")[0];
    try {
      if (req.method === "GET" && path === "/health/live") {
        send(res, { service: config.SERVICE, status: "live" });
        return;
      }
      const actual = Buffer.from(String(req.headers.authorization ?? "")),
        expected = Buffer.from("Bearer " + config.SERVICE_TOKEN);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new HttpError(401, "Internal service authorization required");
      if (req.method === "GET" && path === "/health/ready") {
        await pool.query("SELECT 1");
        send(res, {
          service: config.SERVICE,
          status: "ready",
          ...((await ready?.()) as object),
        });
        return;
      }
      await handler({ req, res, path, correlationId });
      log("request_completed", correlationId, {
        method: req.method,
        path,
        status: res.statusCode,
      });
    } catch (e) {
      const status =
        e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 503;
      log("request_failed", correlationId, {
        path,
        status,
        ...(process.env.NODE_ENV !== "production"
          ? { details: e instanceof Error ? e.message : String(e) }
          : {}),
      });
      if (!res.headersSent)
        send(
          res,
          {
            error:
              e instanceof HttpError
                ? e.message
                : e instanceof ZodError
                  ? "Request does not match the v1 contract"
                  : "Service temporarily unavailable",
            correlationId,
          },
          status,
        );
      else res.end();
    }
  });
  server.listen(config.PORT, config.HOST, () =>
    log("listening", "startup", { port: config.PORT }),
  );
  return server;
}
