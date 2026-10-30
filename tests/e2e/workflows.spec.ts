import { encryptedPDF } from "../pdf-encryption";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import type { Page } from "@playwright/test";
const origin = "http://127.0.0.1:3001";
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
  await page.getByRole("button", { name: "Correct extracted data" }).click();
  await page
    .getByRole("textbox", { name: "Correct total", exact: true })
    .fill("11800.00");
  await page
    .getByRole("textbox", { name: "Review reason" })
    .fill("Verified INR 11800 total against supplier copy");
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
  await page.reload();
  await expect(
    page.getByText("revision 2", { exact: false }).first(),
  ).toBeVisible();
  const ambiguous = await processSample(page, 4);
  expect(ambiguous.state.evaluation.candidates).toEqual([
    "PO-2026-301",
    "PO-2026-302",
  ]);
  expect(ambiguous.state.evaluation.poId).toBeNull();
  await page.getByLabel("Purchase order candidate").selectOption("PO-2026-302");
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
  await expect(
    page.getByRole("heading", { name: "Invoice overview." }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search invoices" })
    .fill("NS-2026-SCAN");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
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
test("PDF input failures and authorization boundaries are visible", async ({
  page,
  request,
}) => {
  await page.goto("/upload");
  await page.getByLabel("Invoice PDF").setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.locator(".notice[role=alert]")).toContainText(
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
  await page.getByLabel("Invoice PDF").setInputFiles({
    name: "corrupt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nUnreadable corrupt content %%EOF"),
  });
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
  await page.setViewportSize({ width: 393, height: 851 });
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
      .toEqual({ width: 393, scroll: 393 });
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
    await expect(page.getByText("Worker connected")).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
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
