import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function authorize(request: Request) {
  const mode = process.env.AUTH_MODE ?? "local",
    url = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000");
  if (mode === "individual")
    throw new AuthError(401, "An individual session is required.");
  if (process.env.APP_ENV === "production" && mode !== "individual")
    throw new AuthError(
      503,
      "Production requires individual workspace authentication.",
    );
  if (mode !== "local" && mode !== "basic" && mode !== "individual")
    throw new AuthError(503, "Workspace authentication mode is invalid.");
  if (mode === "basic" && (process.env.WORKSPACE_PASSWORD ?? "").length < 16)
    throw new AuthError(503, "Workspace authentication is not configured.");
  if (mode === "local") {
    const host = request.headers
      .get("host")
      ?.replace(/^\[([^\]]+)\].*$/, "$1")
      .split(":")[0];
    if (!host || !["127.0.0.1", "localhost", "::1"].includes(host))
      throw new AuthError(403, "This workspace is restricted to local access.");
  } else {
    const expected = Buffer.from(
        "Basic " +
          Buffer.from(
            (process.env.WORKSPACE_USER ?? "reviewer") +
              ":" +
              (process.env.WORKSPACE_PASSWORD ?? ""),
          ).toString("base64"),
      ),
      actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new AuthError(401, "Workspace sign-in required.");
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    (request.headers.get("origin") !== url.origin ||
      request.headers.get("host") !== url.host)
  )
    throw new AuthError(403, "Request origin is not allowed.");
}
const buckets = new Map<string, { start: number; count: number }>();
export function rateLimit(request: Request) {
  const key = request.headers.get("authorization") ?? "local",
    now = Date.now();
  let item = buckets.get(key);
  if (!item || now - item.start > 60000) {
    item = { start: now, count: 0 };
    buckets.set(key, item);
  }
  if (++item.count > 30)
    throw new AuthError(429, "Too many requests. Try again in one minute.");
}
