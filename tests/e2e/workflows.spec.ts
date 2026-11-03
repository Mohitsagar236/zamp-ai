import { encryptedPDF } from "../pdf-encryption";
import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Page } from "@playwright/test";
const origin = "http://127.0.0.1:3001";
test("upload retry after a committed lost response survives reload without a second invoice", async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const document = pdf.addPage([612, 792]);
  const number = "LOST-" + Date.now();
  [
    "Supplier: Northstar Office Supplies",
    "Supplier ID: GST-NORTHSTAR-01",
    "Invoice number: " + number,
    "Invoice date: 2026-10-21",
    "PO reference: PO-2026-101",
    "Currency: INR",
    "Subtotal: 100.00",
    "Tax: 18.00",
    "Total: 118.00",
  ].forEach((line, index) =>
    document.drawText(line, { x: 40, y: 740 - index * 30, size: 14, font }),
  );
  const buffer = Buffer.from(await pdf.save());
  let committedId = "";
  await page.goto("/upload");
  await page.route("**/api/invoices", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedId = (await response.json()).id;
    await route.abort("failed");
  });
  await page.getByLabel("Invoice PDF", { exact: true }).setInputFiles({
    name: "lost-response.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await page.getByRole("button", { name: "Upload & process" }).click();
  await expect.poll(() => committedId).not.toBe("");
  await page.unroute("**/api/invoices");
  await page.reload();
  await page.getByLabel("Invoice PDF", { exact: true }).setInputFiles({
    name: "lost-response.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await page.getByRole("button", { name: "Upload & process" }).click();
  await expect(page).toHaveURL(new RegExp("/invoices/" + committedId));
  const rows = await (await page.request.get("/api/invoices")).json();
  expect(
    rows.filter(
      (row: { filename: string }) => row.filename === "lost-response.pdf",
    ),
  ).toHaveLength(1);
});
async function processSample(page: Page, index: number) {
  await page.goto("/upload");
  await page.getByRole("button", { name: "Process sample" }).nth(index).click();
  await expect(page).toHaveURL(/\/invoices\//);
  const id = page.url().split("/").pop()!;
  await page.reload();
  await expect
    .poll(
      async () => {
        const r = await page.request.get("/api/invoices/" + id);
        return (await r.json()).status;
      },
      { timeout: 130000 },
    )
    .toBe("completed");
  await expect(page.getByText("Persisted run history")).toBeVisible();
  const result = await (await page.request.get("/api/invoices/" + id)).json();
  return result;
}
test("real PDFs: happy path, four edges, correction, PO selection, audit and refresh", async ({
  page,
}) => {
  const happy = await processSample(page, 0);
  await expect(
    page.getByRole("img", { name: /Original invoice PDF, page 1/ }),
  ).toBeVisible();
  expect(
    await page.locator("canvas").evaluate((c: HTMLCanvasElement) => c.width),
  ).toBeGreaterThan(500);
  expect(happy.state.evaluation.decision).toBe("READY_FOR_APPROVAL");
  expect(happy.state.extraction.provider).toBe("PDF.js text");
  await expect(
    page.getByRole("button", { name: "Approve invoice" }),
  ).toBeVisible();
  const duplicate = await processSample(page, 1);
  expect(duplicate.state.evaluation.decision).toBe("BLOCKED");
  expect(duplicate.state.evaluation.duplicateOf).toBe(happy.id);
  await expect(
    page.getByRole("button", { name: "Approve invoice" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "View earlier invoice" }),
  ).toBeVisible();
  const split = await processSample(page, 2);
  expect(split.state.evaluation.balance.excess).toBe("1000000");
  expect(split.state.evaluation.balance.prior).toBe("7000000");
  expect(split.state.evaluation.decision).toBe("BLOCKED");
  const scan = await processSample(page, 3);
  expect(scan.state.extraction.provider).toContain("Tesseract");
  expect(scan.state.fields.total).toBeNull();
  expect(scan.state.evaluation.decision).toBe("NEEDS_REVIEW");
  const correct = page.getByRole("button", { name: "Correct extracted data" });
  await correct.click();
  await page.keyboard.press("Escape");
  await expect(correct).toBeFocused();
  await correct.click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Correct total", exact: true })
    .fill("11800.00");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Review reason" })
    .fill("Verified INR 11800 total against supplier copy");
  await page
    .getByRole("checkbox", {
      name: "I checked all extracted values against the original scan.",
    })
    .check();
  await page.getByRole("button", { name: "Save & re-run checks" }).click();
  await expect
    .poll(async () => {
      const s = await (
        await page.request.get("/api/invoices/" + scan.id)
      ).json();
      return s.state.evaluation?.decision;
    })
    .toBe("READY_FOR_APPROVAL");
  const revised = await (
    await page.request.get("/api/invoices/" + scan.id)
  ).json();
  expect(revised.state.extraction.fields.total).toBeNull();
  expect(revised.state.fields.total).toBe("11800.00");
  expect(revised.state.revision).toBe(2);
  const correction = revised.state.history.find(
    (entry: { action: string }) => entry.action === "correct",
  );
  expect(correction.reason).toBe(
    "Verified INR 11800 total against supplier copy",
  );
  expect(correction.actor).toContain("individual identity unavailable");
  expect(correction.previousFields.total).toBeNull();
  expect(correction.correctedFields.total).toBe("11800.00");
  expect(correction.generation).toBe(2);
  expect(correction.correlationId).toBeTruthy();
  const auditEvents = await (
    await page.request.get(`/api/invoices/${scan.id}/events`)
  ).json();
  expect(
    auditEvents.some(
      (event: { type: string; data: { reason?: string } }) =>
        event.type === "review_requested" &&
        event.data.reason === correction.reason,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByText(/Revision 2/).first()).toBeVisible();
  await expect(page.getByText(correction.reason)).toBeVisible();
  const changeDetails = page.getByText("View original and corrected values");
  await changeDetails.click();
  await expect(changeDetails.locator("..\u002fpre")).toContainText(
    '"total": "11800.00"',
  );
  const ambiguous = await processSample(page, 4);
  expect(ambiguous.state.evaluation.candidates).toEqual([
    "PO-2026-301",
    "PO-2026-302",
  ]);
  expect(ambiguous.state.evaluation.poId).toBeNull();
  await page.getByRole("radio", { name: /PO-2026-302/ }).check();
  await page
    .getByRole("textbox", { name: "Review reason" })
    .fill("Confirmed website design order with supplier");
  await page.getByRole("button", { name: "Confirm PO & re-run" }).click();
  await expect
    .poll(async () => {
      const s = await (
        await page.request.get("/api/invoices/" + ambiguous.id)
      ).json();
      return s.state.evaluation?.decision;
    })
    .toBe("READY_FOR_APPROVAL");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search invoices" })
    .fill("NS-2026-SCAN");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.goto("/invoices/" + happy.id);
  await page
    .getByRole("textbox", { name: "Review reason" })
    .fill("Verified the clean invoice against the original PDF");
  const approve = page.getByRole("button", {
    name: "Approve invoice",
    exact: true,
  });
  await approve.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep reviewing" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(approve).toBeFocused();
  await approve.click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/invoices/" + happy.id)).json())
          .state.review,
    )
    .toBe("approved");
  await expect(
    page.getByText(
      "Approval request saved. Recommendation recording is pending.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  const refs = await (await page.request.get("/api/references")).json();
  expect(
    refs.commitments.filter(
      (c: { invoiceId: string }) =>
        c.invoiceId === duplicate.id || c.invoiceId === split.id,
    ),
  ).toHaveLength(0);
  expect(
    refs.commitments.filter(
      (c: { invoiceId: string }) => c.invoiceId === happy.id,
    ),
  ).toHaveLength(1);
});
test("unseen synthetic multi-page and unfamiliar date PDFs use real extraction", async ({
  request,
}) => {
  async function uploadPages(pages: string[][], filename: string) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const lines of pages) {
      const page = pdf.addPage([612, 792]);
      lines.forEach((line, i) =>
        page.drawText(line, { x: 42, y: 740 - i * 32, size: 14, font }),
      );
    }
    const response = await request.post("/api/invoices", {
      headers: { Origin: origin },
      multipart: {
        file: {
          name: filename,
          mimeType: "application/pdf",
          buffer: Buffer.from(await pdf.save()),
        },
      },
    });
    expect(response.status()).toBe(201);
    const { id } = await response.json();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/invoices/${id}`)).json()).status,
        { timeout: 130000 },
      )
      .toBe("completed");
    return (await request.get(`/api/invoices/${id}`)).json();
  }
  const multi = await uploadPages(
    [
      [
        "Synthetic invoice copy for independent extraction verification",
        "Supplier: Northstar Office Supplies",
        "Supplier ID: GST-NORTHSTAR-01",
        "Invoice number: BENCH-MULTI-01",
        "Invoice date: 2026-10-21",
      ],
      [
        "Continued invoice page, summary of charges for supplies",
        "PO reference: PO-2026-101",
        "Currency: INR",
        "Subtotal: 100.00",
        "Tax: 18.00",
        "Total: 118.00",
      ],
    ],
    "unseen-multipage.pdf",
  );
  expect(multi.state.extraction.provider).toBe("PDF.js text");
  expect(multi.state.extraction.pageCount).toBe(2);
  expect(multi.state.fields).toMatchObject({
    supplierId: "GST-NORTHSTAR-01",
    invoiceNumber: "BENCH-MULTI-01",
    invoiceDate: "2026-10-21",
    poReference: "PO-2026-101",
    currency: "INR",
    subtotal: "100.00",
    tax: "18.00",
    total: "118.00",
  });
  const unfamiliar = await uploadPages(
    [
      [
        "Synthetic invoice showing an unfamiliar date format",
        "Supplier: Northstar Office Supplies",
        "Supplier ID: GST-NORTHSTAR-01",
        "Invoice number: BENCH-DATE-02",
        "Invoice date: 21/10/2026",
        "PO reference: PO-2026-101",
        "Currency: INR",
        "Subtotal: 100.00",
        "Tax: 18.00",
        "Total: 118.00",
      ],
    ],
    "unseen-date.pdf",
  );
  expect(unfamiliar.state.fields.invoiceDate).toBe("2026-10-21");
  expect(
    unfamiliar.state.extraction.warnings.some((warning: string) =>
      warning.includes("normalized"),
    ),
  ).toBe(true);
  expect(unfamiliar.state.evaluation.decision).toBe("NEEDS_REVIEW");
  const corrected = await request.post(
    `/api/invoices/${unfamiliar.id}/review`,
    {
      headers: { Origin: origin },
      data: {
        action: "correct",
        reason:
          "Verify a supported 200-row item correction across service boundaries",
        verifiedExtraction: true,
        fields: {
          ...unfamiliar.state.fields,
          lineItems: Array.from({ length: 200 }, (_, i) => ({
            description: `Synthetic item ${i} ${"a".repeat(480)}`,
            quantity: "1",
            unitPrice: "0.50",
            amount: "0.50",
          })),
        },
      },
    },
  );
  expect(corrected.status(), await corrected.text()).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/invoices/${unfamiliar.id}`)).json())
          .status,
    )
    .toBe("completed");
  const withItems = await (
    await request.get(`/api/invoices/${unfamiliar.id}`)
  ).json();
  expect(withItems.state.evaluation.inputs.lineItems).toHaveLength(200);
  expect(withItems.state.evaluation.decision).toBe("READY_FOR_APPROVAL");
});

test("PDF input failures and authorization boundaries are visible", async ({
  page,
  request,
}) => {
  await page.goto("/upload");
  await page.getByLabel("Invoice PDF", { exact: true }).setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf"),
  });
  await page.getByRole("button", { name: "Upload & process" }).click();
  await expect(page.locator("#upload-error")).toContainText(
    "File content is not a PDF",
  );
  const items = await (await request.get("/api/invoices")).json();
  const denied = await request.get(
    "/api/invoices/" + items[0].id + "/document",
    { headers: { host: "evil.example" } },
  );
  expect(denied.status()).toBe(403);
  const encrypted = await request.post("/api/invoices", {
    headers: { Origin: origin },
    multipart: {
      file: {
        name: "encrypted.pdf",
        mimeType: "application/pdf",
        buffer: encryptedPDF(),
      },
    },
  });
  const encryptedId = (await encrypted.json()).id;
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/invoices/" + encryptedId)).json())
          .status,
    )
    .toBe("failed");
  expect(
    (await (await request.get("/api/invoices/" + encryptedId)).json()).state
      .error,
  ).toContain("Encrypted");
  const unauthorized = await request.get("/api/invoices", {
    headers: { host: "evil.example" },
  });
  expect(unauthorized.status()).toBe(403);
  const cross = await request.post("/api/invoices", {
    headers: { Origin: "http://evil.example" },
  });
  expect(cross.status()).toBe(403);
  await page.getByLabel("Invoice PDF", { exact: true }).setInputFiles({
    name: "corrupt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nUnreadable corrupt content %%EOF"),
  });
  await page.getByRole("button", { name: "Upload & process" }).click();
  await expect(page).toHaveURL(/invoices/);
  const id = page.url().split("/").pop();
  await expect
    .poll(async () => {
      return (await (await request.get("/api/invoices/" + id)).json()).status;
    })
    .toBe("failed");
  await expect(
    page.getByText("We couldn’t process this document"),
  ).toBeVisible();
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 11; i++) pdf.addPage();
  const res = await request.post("/api/invoices", {
    headers: { Origin: origin },
    multipart: {
      file: {
        name: "too-many-pages.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      },
    },
  });
  expect(res.ok()).toBe(true);
  const pageId = (await res.json()).id;
  await expect
    .poll(async () => {
      return (await (await request.get("/api/invoices/" + pageId)).json())
        .status;
    })
    .toBe("failed");
  expect(
    (await (await request.get("/api/invoices/" + pageId)).json()).state.error,
  ).toContain("10-page limit");
});
test("mobile viewport keeps all screens navigable without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 851 });
  for (const route of ["/", "/upload", "/records", "/policy"]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("nav")).toBeVisible();
    await expect
      .poll(
        async () =>
          page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
          })),
        { message: `Viewport overflow at ${route}` },
      )
      .toEqual({ width: 390, scroll: 390 });
  }
  await page.goto("/");
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
});

test("core screens meet automated WCAG checks", async ({ page }) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const items = await (await page.request.get("/api/invoices")).json();
  for (const route of [
    "/",
    "/upload",
    "/records",
    "/policy",
    "/invoices/" +
      items.find(
        (r: { filename: string }) => r.filename === "scan-missing-total.pdf",
      ).id,
  ]) {
    await page.goto(route);
    await expect(page.getByText("Processing available")).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      scan.violations,
      JSON.stringify(
        scan.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        null,
        2,
      ),
    ).toEqual([]);
  }
});

test("file selection is explicit, repeated clicks register only once, and results stay real", async ({
  page,
}) => {
  await page.goto("/upload");
  await page
    .getByLabel("Invoice PDF", { exact: true })
    .setInputFiles("public/samples/happy-path.pdf");
  await expect(page.locator(".selected-file")).toContainText("happy-path.pdf");
  await expect(page).toHaveURL(/upload/);
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/invoices"))
      uploads++;
  });
  await page
    .getByRole("button", { name: "Upload & process" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(page).toHaveURL(/invoices\//);
  expect(uploads).toBe(1);
});
test("reconnect clears the connection notice and preserves a typed review reason", async ({
  page,
  context,
}) => {
  const rows = await (await page.request.get("/api/invoices")).json();
  const row = rows.find(
    (r: { filename: string; state: { review: string } }) =>
      r.filename === "ambiguous-po.pdf" && r.state.review === "pending",
  );
  expect(row).toBeTruthy();
  await page.goto("/invoices/" + row.id);
  const reason = page.getByRole("textbox", { name: "Review reason" });
  await reason.fill("Preserve this verified review reason while reconnecting");
  await context.setOffline(true);
  await expect(
    page.getByText("Connection interrupted", { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByText("Connection interrupted", { exact: true }),
  ).not.toBeVisible();
  await expect(reason).toHaveValue(
    "Preserve this verified review reason while reconnecting",
  );
  await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(
    0,
  );
});
test("390, 768 and 1440 pixel layouts include readable detail controls without page overflow", async ({
  page,
}) => {
  const rows = await (await page.request.get("/api/invoices")).json();
  const scan = rows.find(
    (r: { filename: string }) => r.filename === "scan-missing-total.pdf",
  );
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    for (const route of [
      "/",
      "/upload",
      "/records",
      "/policy",
      "/invoices/" + scan.id,
    ]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
          })),
        )
        .toEqual({ width, scroll: width });
    }
    if (width === 390) {
      await expect(
        page.getByRole("link", { name: "Open original PDF", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Correct extracted data" }),
      ).toBeVisible();
    }
  }
});
