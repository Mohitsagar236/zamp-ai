import { rateLimit, AuthError } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { INVOICE_COMMAND_MAX_BYTES } from "../../../../packages/contracts/src/index";
import { auth, authDb } from "@/lib/better-auth";
import { boundedBody } from "@/lib/request-body";
import {
  signWorkspaceIdentity,
  type WorkspaceRole,
} from "../../../../packages/contracts/src/identity";
type Actor = {
  sub: string;
  email: string;
  name: string;
  role: WorkspaceRole;
} | null;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function base() {
  return process.env.WORKFLOW_URL ?? "http://127.0.0.1:4100";
}
async function forward(
  path: string,
  request: Request,
  method: string,
  body?: BodyInit,
  headers: Record<string, string> = {},
  actor: Actor = null,
) {
  const token = process.env.WORKFLOW_TOKEN;
  if (!token) throw Error("Workflow service gateway token is not configured");
  const id = request.headers.get("x-correlation-id") ?? randomUUID();
  const result = await fetch(
    base() + (path.startsWith("/health/") ? path : "/v1" + path),
    {
      method,
      body,
      headers: {
        Authorization: "Bearer " + token,
        "X-Workspace-Origin": request.headers.get("origin") ?? "",
        "X-Workspace-Host": request.headers.get("host") ?? "",
        "X-Workspace-Authorization": request.headers.get("authorization") ?? "",
        "X-Correlation-ID": id,
        ...(actor
          ? {
              "X-Workspace-Identity": signWorkspaceIdentity(
                actor,
                process.env.WORKFLOW_IDENTITY_SECRET ?? "",
              ),
            }
          : {}),
        ...headers,
      },
      signal: AbortSignal.timeout(
        method === "POST" && body instanceof Uint8Array ? 150000 : 10000,
      ),
    },
  );
  return result;
}
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const actor = await authorize(request);
    const { path } = await context.params;
    const route = path.join("/");
    if (process.env.APP_ENV === "production" && route.startsWith("samples/"))
      return Response.json({ error: "Endpoint not found." }, { status: 404 });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (actor) {
        const bucket = await authDb.query(
          "INSERT INTO request_buckets(principal_id,window_start,requests) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(principal_id,window_start) DO UPDATE SET requests=request_buckets.requests+1 RETURNING requests",
          [actor.sub],
        );
        if (bucket.rows[0].requests > 30)
          throw new AuthError(
            429,
            "Too many requests. Try again in one minute.",
          );
        await authDb.query(
          "DELETE FROM request_buckets WHERE window_start < now()-interval '5 minutes'",
        );
      } else rateLimit(request);
    }
    if (route === "session" && request.method === "GET")
      return Response.json(actor, { headers: { "Cache-Control": "no-store" } });
    if (route === "samples/reference-records.json" && request.method === "GET")
      return new Response(
        await readFile("public/samples/reference-records.json"),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    if (route.startsWith("samples/") && request.method === "GET") {
      const name = route.slice(8);
      if (
        ![
          "happy-path.pdf",
          "duplicate-renamed.pdf",
          "split-overbalance.pdf",
          "scan-missing-total.pdf",
          "ambiguous-po.pdf",
        ].includes(name)
      )
        return Response.json({ error: "Sample not found" }, { status: 404 });
      return new Response(await readFile("public/samples/" + name), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="' + name + '"',
        },
      });
    }
    if (route === "health" && request.method === "GET") {
      const res = await forward(
        "/health/ready",
        request,
        "GET",
        undefined,
        {},
        actor,
      );
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
    if (route === "references" && request.method === "GET") {
      const res = await forward(
        "/references",
        request,
        "GET",
        undefined,
        {},
        actor,
      );
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
    if (route === "references/import" && request.method === "POST") {
      if (actor?.role !== "admin")
        return Response.json(
          { error: "Administrator access required." },
          { status: 403 },
        );
      const body = new TextDecoder().decode(
        await boundedBody(request, 2_100_000),
      );
      if (body.length > 2_100_000)
        return Response.json(
          { error: "Import is too large." },
          { status: 413 },
        );
      let input: { mode?: string; previewId?: string; csv?: string };
      try {
        input = JSON.parse(body);
      } catch {
        return Response.json(
          { error: "Import request is invalid." },
          { status: 400 },
        );
      }
      if (
        !["preview", "commit"].includes(input.mode ?? "") ||
        !/^[a-zA-Z0-9._:-]{1,100}$/.test(input.previewId ?? "") ||
        typeof input.csv !== "string"
      )
        return Response.json(
          { error: "Import request is invalid." },
          { status: 400 },
        );
      const res = await forward(
        "/admin/references/import",
        request,
        "POST",
        body,
        { "Content-Type": "application/json" },
        actor,
      );
      return Response.json(await res.json().catch(() => ({})), {
        status: res.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (route === "reconciliation" && request.method === "POST") {
      if (actor?.role !== "admin")
        return Response.json(
          { error: "Administrator access required." },
          { status: 403 },
        );
      const body = new TextDecoder().decode(await boundedBody(request, 32000));
      let input: { mode?: string };
      try {
        input = JSON.parse(body);
      } catch {
        return Response.json({ error: "Invalid request." }, { status: 400 });
      }
      if (!["scan", "repair"].includes(input.mode ?? ""))
        return Response.json(
          { error: "Choose scan or repair." },
          { status: 400 },
        );
      const res = await forward(
        "/admin/reconciliation",
        request,
        "POST",
        JSON.stringify(input),
        { "Content-Type": "application/json" },
        actor,
      );
      return Response.json(await res.json().catch(() => ({})), {
        status: res.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (route === "invoices" && request.method === "GET") {
      const res = await forward(
        "/invoices",
        request,
        "GET",
        undefined,
        {},
        actor,
      );
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
    if (route === "invoices" && request.method === "POST") {
      const limit = Number(process.env.MAX_FILE_MB ?? 10) * 1024 * 1024;
      const body = await boundedBody(request, limit + 65536);
      let form: FormData;
      try {
        form = await new Response(body, {
          headers: {
            "Content-Type": request.headers.get("content-type") ?? "",
          },
        }).formData();
      } catch {
        throw new AuthError(400, "A valid multipart PDF upload is required.");
      }
      const file = form.get("file");
      if (!(file instanceof File))
        return Response.json(
          { error: "Select a PDF to upload." },
          { status: 400 },
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > Number(process.env.MAX_FILE_MB ?? 10) * 1024 * 1024)
        return Response.json(
          { error: "PDF exceeds the configured size limit." },
          { status: 413 },
        );
      const res = await forward(
        "/invoices",
        request,
        "POST",
        bytes,
        {
          "Content-Type": "application/pdf",
          "X-Filename": file.name,
          "X-Content-SHA256": await hash(bytes),
          "Idempotency-Key":
            request.headers.get("idempotency-key") ?? randomUUID(),
        },
        actor,
      );
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
    let pathname = "/" + route;
    if (
      route.startsWith("invoices/") &&
      request.method === "POST" &&
      route.endsWith("/review")
    ) {
      pathname = "/" + route.slice(0, -7) + "/reviews";
      const body = new TextDecoder().decode(
        await boundedBody(request, INVOICE_COMMAND_MAX_BYTES),
      );
      const parsed = JSON.parse(body);
      if (!z.string().min(5).safeParse(parsed.reason).success)
        return Response.json(
          { error: "Enter a reason of at least 5 characters." },
          { status: 400 },
        );
      const res = await forward(
        pathname,
        request,
        "POST",
        body,
        {
          "Content-Type": "application/json",
        },
        actor,
      );
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
    if (route.startsWith("invoices/") && request.method === "GET") {
      const res = await forward(pathname, request, "GET", undefined, {}, actor);
      const headers = new Headers(res.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(res.body, { status: res.status, headers });
    }
    return Response.json({ error: "Endpoint not found." }, { status: 404 });
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 503;
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Service temporarily unavailable.",
      },
      {
        status,
        headers:
          status === 401
            ? {
                "WWW-Authenticate":
                  'Basic realm="InvoiceLens", charset="UTF-8"',
              }
            : {},
      },
    );
  }
}
async function authorize(request: Request): Promise<Actor> {
  const mode = process.env.AUTH_MODE ?? "local";
  if (mode === "individual") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw new AuthError(401, "Sign in required.");
    const role = (session.user as typeof session.user & { role?: string }).role;
    if (role !== "admin" && role !== "reviewer" && role !== "viewer")
      throw new AuthError(403, "Workspace role is invalid.");
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      role === "viewer"
    )
      throw new AuthError(403, "Viewer accounts cannot change invoices.");
    if (role === "admin" && !process.env.WORKFLOW_IDENTITY_SECRET)
      throw new AuthError(503, "Identity signing is not configured.");
    const url = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (request.headers.get("origin") !== url.origin ||
        request.headers.get("host") !== url.host)
    )
      throw new AuthError(403, "Request origin is not allowed.");
    return {
      sub: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role,
    };
  }
  const { authorize: legacyAuthorize } = await import("@/lib/auth");
  legacyAuthorize(request);
  return null;
}
async function hash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const GET = handle,
  POST = handle;
