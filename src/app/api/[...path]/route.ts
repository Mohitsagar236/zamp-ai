import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { authorize, rateLimit } from "@/lib/auth";
import { config, policy } from "@/lib/config";
import { db } from "@/lib/db";
import {
  upload,
  listInvoices,
  getInvoice,
  review,
  references,
  invoiceEvents,
} from "@/lib/service";
import { InputError, storage } from "@/lib/storage";
import { fieldsSchema } from "@/lib/types";
import { ZodError } from "zod";
import { readFile } from "node:fs/promises";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    authorize(req);
    const { path } = await params;
    if (req.method === "GET" && path[0] === "health") {
      await db.execute(sql`SELECT 1`);
      const r = await db.execute(
        sql`SELECT at FROM worker_heartbeat WHERE at>now()-interval '30 seconds'`,
      );
      return json({
        database: "ready",
        worker: r.rows.length ? "ready" : "offline",
        ocr: config.OCR_PROVIDER,
        limits: { maxMB: config.MAX_FILE_MB, maxPages: config.MAX_PAGES },
        policy,
        authMode: config.AUTH_MODE,
      });
    }
    if (req.method === "GET" && path[0] === "references")
      return json(await references());
    if (req.method === "GET" && path[0] === "samples" && path[1]) {
      const files = [
        "happy-path.pdf",
        "duplicate-renamed.pdf",
        "split-overbalance.pdf",
        "scan-missing-total.pdf",
        "ambiguous-po.pdf",
        "reference-records.json",
      ];
      if (!files.includes(path[1]))
        throw new InputError("Sample not found", 404);
      return new Response(await readFile("public/samples/" + path[1]), {
        headers: {
          "Content-Type": path[1].endsWith(".pdf")
            ? "application/pdf"
            : "application/json",
          "Content-Disposition": `attachment; filename="${path[1]}"`,
        },
      });
    }
    if (path[0] === "invoices" && path.length === 1) {
      if (req.method === "GET") return json(await listInvoices());
      if (req.method === "POST") {
        rateLimit(req);
        const length = Number(req.headers.get("content-length"));
        if (!length || length > (config.MAX_FILE_MB + 1) * 1024 * 1024)
          throw new InputError(
            "Upload is too large or has no declared length.",
            413,
          );
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File))
          throw new InputError("Select a PDF to upload.");
        const id = await upload(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
        );
        return json({ id }, 201);
      }
    }
    if (path[0] === "invoices" && path[1]) {
      const id = path[1];
      if (req.method === "GET" && path.length === 2)
        return json(await getInvoice(id));
      if (req.method === "GET" && path[2] === "events")
        return json(await invoiceEvents(id));
      if (req.method === "GET" && path[2] === "document") {
        const r = await getInvoice(id);
        return new Response(new Uint8Array(await storage.get(r.storageKey)), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="invoice-${r.id}.pdf"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
          },
        });
      }
      if (req.method === "POST" && path[2] === "review") {
        rateLimit(req);
        if (Number(req.headers.get("content-length") ?? 0) > 32000)
          throw new InputError("Review request too large.", 413);
        const b = await req.json();
        if (typeof b.action !== "string" || typeof b.reason !== "string")
          throw new InputError("Action and review reason are required.");
        return json(
          await review(
            id,
            b.action,
            b.reason,
            b.fields ? fieldsSchema.parse(b.fields) : undefined,
            b.selectedPo,
          ),
        );
      }
    }
    throw new InputError("Endpoint not found.", 404);
  } catch (e) {
    if (e instanceof InputError)
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status,
        headers: {
          "Content-Type": "application/json",
          ...(e.status === 401
            ? {
                "WWW-Authenticate":
                  'Basic realm="InvoiceLens", charset="UTF-8"',
              }
            : {}),
        },
      });
    if (e instanceof ZodError)
      return json(
        {
          error:
            "Some fields are invalid. Check dates, currency and monetary values.",
          details: e.issues.map((x) => ({
            field: x.path.join("."),
            message: x.message,
          })),
        },
        400,
      );
    console.error(JSON.stringify({ event: "request_failed" }));
    return json(
      {
        error:
          "The request could not be completed. Check database and worker readiness.",
      },
      500,
    );
  }
}
export { handle as GET, handle as POST };
