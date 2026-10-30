import { timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { InputError } from "./storage";
const same = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function authorize(request: Request) {
  if (config.AUTH_MODE === "local") {
    const host = request.headers.get("host")?.split(":")[0];
    if (!host || !["localhost", "127.0.0.1", "["].includes(host))
      throw new InputError(
        "This workspace is restricted to local access.",
        403,
      );
  } else {
    const header = request.headers.get("authorization") ?? "";
    const expected = Buffer.from(
      `${config.WORKSPACE_USER}:${config.WORKSPACE_PASSWORD}`,
    ).toString("base64");
    if (!same(header, "Basic " + expected))
      throw new InputError("Workspace sign-in required.", 401);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (
      origin !== new URL(config.APP_URL).origin ||
      request.headers.get("host") !== new URL(config.APP_URL).host
    )
      throw new InputError("Request origin is not allowed.", 403);
  }
}
const buckets = new Map<string, { start: number; count: number }>();
export function rateLimit(request: Request) {
  const key = request.headers.get("authorization") ?? "local";
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > 60000) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  if (++b.count > 30)
    throw new InputError("Too many requests. Try again in one minute.", 429);
}
