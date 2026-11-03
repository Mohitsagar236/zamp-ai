"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileText,
  LoaderCircle,
  Minus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { Fields, Finding, Invoice, PO } from "@/lib/types";
import { requiresSourceVerification } from "@/lib/types";
import { amount } from "@/lib/money";
import {
  date,
  findingName,
  isActive,
  labels,
  money,
  type References,
  type ReviewAction,
} from "./presentation";
import { Confirm, Dialog, Panel, Status } from "./ui";
import Corrections from "./corrections";
import DocumentPreview from "./document-preview";
type Action = (
  action: ReviewAction,
  reason: string,
  fields?: Fields,
  selectedPo?: string,
  verifiedExtraction?: boolean,
) => Promise<boolean>;
function PurchaseOrderChoices({
  orders,
  refs,
  invoice,
  value,
  onChange,
}: {
  orders: PO[];
  refs: References;
  invoice: Invoice;
  value: string;
  onChange: (v: string) => void;
}) {
  const group = useId();
  return (
    <fieldset className="po-choices">
      <legend>Choose the verified purchase order</legend>
      <p>Compare each order with the original invoice before selecting.</p>
      {orders.map((po) => {
        const prior = refs.commitments
          .filter((c) => c.poId === po.id && c.invoiceId !== invoice.id)
          .reduce((s, c) => s + BigInt(c.amountMinor), 0n);
        return (
          <label
            className={"po-choice " + (value === po.id ? "selected" : "")}
            key={po.id}
          >
            <div className="po-choice-top">
              <input
                type="radio"
                name={group}
                aria-label={po.id + " " + po.description}
                checked={value === po.id}
                onChange={() => onChange(po.id)}
              />
              <strong>{po.id}</strong>
              <span className="small-label">
                {po.status === "open" ? "Open order" : po.status}
              </span>
            </div>
            <p>{po.description}</p>
            <dl>
              <div>
                <dt>Limit</dt>
                <dd className="numeric">
                  {amount(po.limitMinor, po.currency)}
                </dd>
              </div>
              <div>
                <dt>Already committed</dt>
                <dd className="numeric">{amount(prior, po.currency)}</dd>
              </div>
              <div>
                <dt>Available for this invoice</dt>
                <dd className="numeric">
                  {amount(BigInt(po.limitMinor) - prior, po.currency)}
                </dd>
              </div>
            </dl>
          </label>
        );
      })}
    </fieldset>
  );
}
function ReviewPanel({
  invoice,
  refs,
  onAction,
  busy,
  error,
}: {
  invoice: Invoice;
  refs: References;
  onAction: Action;
  busy: boolean;
  error: string;
}) {
  const [reason, setReason] = useState(""),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState<"approve" | "reject" | null>(null),
    [changePo, setChangePo] = useState(false);
  const e = invoice.state.evaluation,
    active = isActive(invoice),
    finalized = invoice.state.review !== "pending";
  const id = useId();
  const candidates = refs.pos.filter((p) => e?.candidates.includes(p.id));
  const alternativeOrders = refs.pos.filter(
    (p) =>
      p.vendorId === e?.vendorId &&
      p.currency === invoice.state.fields?.currency,
  );
  async function act(action: ReviewAction) {
    if (await onAction(action, reason, undefined, selected || undefined)) {
      setReason("");
      setSelected("");
      setChangePo(false);
      setConfirm(null);
    }
  }
  return (
    <>
      <Panel
        title="Your review"
        className="review-panel"
        action={<Status value={invoice.state.review} />}
      >
        <div className="panel-body">
          {finalized ? (
            <div className="final-review">
              <ShieldCheck size={24} />
              <h3>Invoice {invoice.state.review}</h3>
              <p>
                Your recorded review and the automated recommendation are
                retained separately in the audit history.
              </p>
            </div>
          ) : active ? (
            <p className="muted">
              Review controls will be available when processing finishes. You
              can leave this page and return later.
            </p>
          ) : (
            <>
              {candidates.length > 1 && (
                <PurchaseOrderChoices
                  orders={candidates}
                  refs={refs}
                  invoice={invoice}
                  value={selected}
                  onChange={setSelected}
                />
              )}
              <div className="review-tools">
                {invoice.state.fields && (
                  <button className="button" onClick={() => setEditing(true)}>
                    Correct extracted data
                  </button>
                )}
                {e?.poId && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(e.poId!);
                      setChangePo(true);
                    }}
                  >
                    Change purchase order
                  </button>
                )}
              </div>
              <label className="form-field" htmlFor={id + "-reason"}>
                <span>
                  Review reason <span className="required-hint">Required</span>
                </span>
                <textarea
                  id={id + "-reason"}
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain what you verified or decided."
                  aria-describedby={id + "-reason-help"}
                />
                <small id={id + "-reason-help"}>
                  Add at least 5 characters. Your reason is saved with this
                  action.
                </small>
              </label>
              {error && !editing && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="review-actions">
                {selected && candidates.length > 1 && (
                  <button
                    className="button primary"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() => void act("select-po")}
                  >
                    Confirm PO & re-run
                  </button>
                )}
                {e?.decision === "READY_FOR_APPROVAL" &&
                  invoice.status === "completed" &&
                  (!requiresSourceVerification(invoice.state.extraction) ||
                    invoice.state.extractionVerified) && (
                    <button
                      className="button primary"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() => setConfirm("approve")}
                    >
                      <Check size={17} />
                      Approve invoice
                    </button>
                  )}
                <button
                  className="button"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() =>
                    void act(invoice.status === "failed" ? "retry" : "rerun")
                  }
                >
                  <RefreshCw size={16} />
                  {invoice.status === "failed"
                    ? "Retry processing"
                    : "Re-run checks"}
                </button>
                <button
                  className="button danger-outline"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => setConfirm("reject")}
                >
                  Reject invoice
                </button>
              </div>
              <p className="review-footnote">
                <ShieldCheck size={15} />
                Hard controls must pass before approval. No payment is made.
              </p>
            </>
          )}
        </div>
      </Panel>
      {editing && (
        <Corrections
          invoice={invoice}
          onClose={() => setEditing(false)}
          busy={busy}
          error={error}
          onSave={(fields, why, verified) =>
            onAction("correct", why, fields, undefined, verified)
          }
        />
      )}
      <Confirm
        error={error}
        action={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void act(confirm)}
        busy={busy}
        invoice={invoice.state.fields?.invoiceNumber ?? invoice.filename}
        amount={money(
          invoice.state.fields?.total,
          invoice.state.fields?.currency,
        )}
        po={e?.poId}
      />
      <Dialog
        open={changePo}
        onClose={() => setChangePo(false)}
        title="Change purchase order"
        description="Selecting a different order runs all checks again. It does not bypass a balance or eligibility control."
        wide
      >
        <div className="dialog-body">
          <PurchaseOrderChoices
            orders={alternativeOrders}
            refs={refs}
            invoice={invoice}
            value={selected}
            onChange={setSelected}
          />
          <label className="form-field">
            <span>Reason for changing purchase order</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Which order did you verify with the supplier?"
            />
          </label>
          {error && <p className="inline-error">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button className="button" onClick={() => setChangePo(false)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !selected || reason.trim().length < 5}
            onClick={() => void act("select-po")}
          >
            Confirm PO & re-run
          </button>
        </div>
      </Dialog>
    </>
  );
}
const stageTitles = [
  "Store invoice securely",
  "Inspect document",
  "Read invoice details",
  "Validate extracted fields",
  "Load supplier & PO records",
  "Check invoice and PO balance",
  "Confirm saved recommendation",
];
function Timeline({ invoice }: { invoice: Invoice }) {
  const active = isActive(invoice),
    current = invoice.state.stages.find((s) => s.status === "running");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <details className="surface timeline" open={active || undefined}>
      <summary>
        <span>
          <Clock3 size={18} />
          <strong>
            {active ? "Processing invoice" : "Processing timeline"}
          </strong>
          <span className="timeline-context">
            {active
              ? current
                ? stageTitles[invoice.state.stages.indexOf(current)]
                : "Waiting to start"
              : "Persisted run history"}
          </span>
        </span>
        <Status value={invoice.status} />
      </summary>
      <ol className="stage-list">
        {invoice.state.stages.map((s, i) => (
          <li key={s.name} className={"stage " + s.status}>
            <span className="stage-indicator">
              {s.status === "completed" ? (
                <Check size={16} />
              ) : s.status === "running" ? (
                <LoaderCircle className="spin" size={16} />
              ) : s.status === "failed" ? (
                <XCircle size={16} />
              ) : s.status === "skipped" ? (
                <Minus size={16} />
              ) : (
                i + 1
              )}
            </span>
            <div>
              <strong>{stageTitles[i]}</strong>
              <span className="stage-status">
                {labels[s.status] ?? s.status}
                {s.startedAt && (
                  <span>
                    {" "}
                    ·{" "}
                    {s.endedAt
                      ? Math.max(
                          0,
                          (new Date(s.endedAt).getTime() -
                            new Date(s.startedAt).getTime()) /
                            1000,
                        ).toFixed(1)
                      : Math.max(
                          0,
                          ((now ?? new Date(s.startedAt).getTime()) -
                            new Date(s.startedAt).getTime()) /
                            1000,
                        ).toFixed(1)}
                    s{s.status === "running" ? " elapsed" : ""}
                  </span>
                )}
              </span>
              {s.status === "failed" && <p>{s.message}</p>}
              <details>
                <summary>Execution details</summary>
                {s.startedAt && <p>Started {date(s.startedAt)}</p>}
                <p>{s.message ?? "Waiting for the preceding step."}</p>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
function Checks({ findings }: { findings: Finding[] }) {
  const order = { blocked: 0, review: 1, "not-evaluated": 2, passed: 3 };
  const attention = findings
    .filter((f) => f.status !== "passed")
    .sort((a, b) => order[a.status] - order[b.status]);
  const passed = findings.filter((f) => f.status === "passed");
  const list = (items: Finding[]) =>
    items.map((f, i) => (
      <div className={"check-row " + f.status} key={f.code + i}>
        <span className="check-symbol">
          {f.status === "passed" ? (
            <Check size={17} />
          ) : f.status === "not-evaluated" ? (
            <Minus size={17} />
          ) : (
            <ShieldAlert size={17} />
          )}
        </span>
        <div>
          <div className="check-title">
            <h3>{findingName(f)}</h3>
            <Status value={f.status} />
          </div>
          <p>{f.message}</p>
          <details className="technical-detail">
            <summary>Rule and supporting evidence</summary>
            <p>Rule reference: {f.code}</p>
            {f.evidence !== undefined && (
              <pre>{JSON.stringify(f.evidence, null, 2)}</pre>
            )}
          </details>
        </div>
      </div>
    ));
  return (
    <Panel
      title="Checks and evidence"
      action={<span className="small-label">{findings.length} checks</span>}
    >
      <div className="checks-list">
        {attention.length ? (
          list(attention)
        ) : (
          <div className="checks-clear">
            <ShieldCheck size={20} />
            <span>All required checks passed.</span>
          </div>
        )}
        {passed.length > 0 && (
          <details
            className="passed-checks"
            open={attention.length ? undefined : true}
          >
            <summary>
              {passed.length} passed {passed.length === 1 ? "check" : "checks"}
              <ChevronDown size={16} />
            </summary>
            {list(passed)}
          </details>
        )}
      </div>
    </Panel>
  );
}
function Balance({ invoice, refs }: { invoice: Invoice; refs: References }) {
  const e = invoice.state.evaluation,
    b = e?.balance;
  if (!b) return null;
  const currency = invoice.state.fields?.currency ?? "INR";
  const actuallyReserved =
    e.decision === "READY_FOR_APPROVAL" && invoice.state.review !== "rejected";
  return (
    <Panel title="Purchase order balance">
      <div className="panel-body">
        <div className="matched-order">
          <Link className="text-button" href="/records">
            {e.poId}
            <ArrowUpRight size={15} />
          </Link>
          <span>{refs.pos.find((p) => p.id === e.poId)?.description}</span>
        </div>
        <dl className="balance-calculation">
          <div>
            <dt>PO limit</dt>
            <dd className="numeric">{amount(b.limit, currency)}</dd>
          </div>
          <div>
            <dt>Prior commitments</dt>
            <dd className="numeric">− {amount(b.prior, currency)}</dd>
          </div>
          <div className="balance-subtotal">
            <dt>Available before invoice</dt>
            <dd className="numeric">{amount(b.remaining, currency)}</dd>
          </div>
          <div>
            <dt>
              {e.duplicateOf
                ? "Additional invoice impact"
                : "Invoice amount requested"}
            </dt>
            <dd className="numeric">{amount(b.impact, currency)}</dd>
          </div>
        </dl>
        {BigInt(b.excess) > 0n ? (
          <div className="balance-result negative">
            <strong>Exceeds available balance</strong>
            <span className="numeric">{amount(b.excess, currency)}</span>
          </div>
        ) : (
          <div className="balance-result">
            <strong>
              {actuallyReserved
                ? "Available after reservation"
                : "Available if accepted"}
            </strong>
            <span className="numeric">
              {amount(BigInt(b.remaining) - BigInt(b.impact), currency)}
            </span>
          </div>
        )}
        <p className="balance-policy">
          {actuallyReserved
            ? "This recommendation reserves funds against the order."
            : "No additional funds are reserved for this invoice."}{" "}
          Spending beyond the PO limit is not permitted.
        </p>
        {b.commitments.length > 0 && (
          <details>
            <summary>
              Show prior invoice commitments ({b.commitments.length})
            </summary>
            <ul className="commitment-list">
              {(
                b.commitments as {
                  invoiceId: string;
                  label: string;
                  amountMinor: string;
                }[]
              ).map((c) => (
                <li key={c.invoiceId}>
                  <span>
                    {c.invoiceId.startsWith("historical") ? (
                      c.label
                    ) : (
                      <Link href={"/invoices/" + c.invoiceId}>{c.label}</Link>
                    )}
                  </span>
                  <strong className="numeric">
                    {amount(c.amountMinor, currency)}
                  </strong>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}
export default function InvoiceDetail({
  invoice,
  refs,
  onAction,
  busy,
  error,
}: {
  invoice: Invoice;
  refs: References;
  onAction: Action;
  busy: boolean;
  error: string;
}) {
  const e = invoice.state.evaluation,
    f = invoice.state.fields,
    active = isActive(invoice);
  const [preview, setPreview] = useState(true);
  const vendor = refs.vendors.find((v) => v.id === e?.vendorId);
  const primary =
    e?.findings.filter(
      (x) => x.status === "blocked" || x.status === "review",
    ) ?? [];
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={16} />
        All invoices
      </Link>
      <div className="page-title detail-title">
        <div>
          <h1 tabIndex={-1}>{f?.invoiceNumber ?? invoice.filename}</h1>
          <p>
            {f?.supplierName ?? "Supplier details pending"}
            <span className="separator">/</span>
            {f?.total ? money(f.total, f.currency) : "Total not available"}
          </p>
          <div className="invoice-meta">
            <span>Received {date(invoice.createdAt)}</span>
            <span>Revision {invoice.state.revision}</span>
          </div>
        </div>
        <a
          className="button"
          href={"/api/invoices/" + invoice.id + "/document"}
          target="_blank"
          rel="noreferrer"
        >
          <FileText size={17} />
          Original PDF
          <ExternalLink size={14} />
        </a>
      </div>
      <div className="decision-execution">
        <span>
          <span className="small-label">Processing</span>
          <Status value={invoice.status} />
        </span>
        <span>
          <span className="small-label">Human review</span>
          <Status value={invoice.state.review} />
        </span>
      </div>
      {invoice.state.error && (
        <div className="notice negative">
          <XCircle size={23} />
          <div>
            <h2>We couldn’t process this document</h2>
            <p>{invoice.state.error}</p>
            <p>
              Check the original document and use Retry processing with a
              reason.
            </p>
          </div>
        </div>
      )}
      {e && (
        <section
          className={
            "recommendation " +
            (e.decision === "READY_FOR_APPROVAL"
              ? "positive"
              : e.decision === "BLOCKED"
                ? "negative"
                : "caution")
          }
          aria-labelledby="recommendation-title"
        >
          <span className="recommendation-icon">
            {e.decision === "READY_FOR_APPROVAL" ? (
              <ShieldCheck size={28} />
            ) : (
              <ShieldAlert size={28} />
            )}
          </span>
          <div>
            <span className="recommendation-label">
              {invoice.status === "failed"
                ? "Last saved automated recommendation"
                : "Automated recommendation"}
            </span>
            <h2 id="recommendation-title">{labels[e.decision]}</h2>
            <p>
              {invoice.status === "failed"
                ? "Processing has since failed. Check the error before taking further action."
                : e.decision === "READY_FOR_APPROVAL"
                  ? "Required checks passed. Review the evidence before recording your approval."
                  : e.decision === "BLOCKED"
                    ? "A policy control prevents approval. Resolve the underlying issue; approval cannot bypass it."
                    : "Verify the details below to continue the review."}
            </p>
            {primary.length > 0 && (
              <ul className="recommendation-reasons">
                {primary.map((x, i) => (
                  <li key={i}>{findingName(x)}</li>
                ))}
              </ul>
            )}
          </div>
          {e.duplicateOf && !e.duplicateOf.startsWith("historical") && (
            <Link className="button" href={"/invoices/" + e.duplicateOf}>
              View earlier invoice
              <ArrowUpRight size={16} />
            </Link>
          )}
        </section>
      )}
      {active && !e && (
        <div className="processing-note">
          <LoaderCircle className="spin" size={21} />
          <div>
            <h2>Your invoice is being processed</h2>
            <p>
              Details and findings appear as they are saved. It’s safe to leave
              and return.
            </p>
          </div>
        </div>
      )}
      <Timeline invoice={invoice} />
      <div className="review-layout">
        <div className="evidence-column">
          <Panel
            title="Original document"
            className="document-panel"
            action={
              <button
                className="text-button preview-toggle"
                onClick={() => setPreview((v) => !v)}
              >
                {preview ? "Hide preview" : "Show preview"}
              </button>
            }
          >
            <div className="document-toolbar">
              <span>
                <FileText size={16} />
                {invoice.filename}
              </span>
              <a
                className="text-button"
                href={"/api/invoices/" + invoice.id + "/document"}
                target="_blank"
                rel="noreferrer"
              >
                Open PDF
                <ExternalLink size={14} />
              </a>
            </div>
            {preview && <DocumentPreview invoiceId={invoice.id} />}
            <div className="document-fallback">
              <FileText size={24} />
              <p>Review the source document while checking extracted values.</p>
              <a
                className="button"
                href={"/api/invoices/" + invoice.id + "/document"}
                target="_blank"
                rel="noreferrer"
              >
                Open original PDF
                <ExternalLink size={14} />
              </a>
            </div>
          </Panel>
          {invoice.state.extraction && (
            <Panel title="Extracted source evidence">
              <div className="panel-body">
                <p className="muted">
                  Original extraction is retained separately from reviewer
                  corrections.
                </p>
                {invoice.state.extraction.warnings.map((warning, i) => (
                  <div className="evidence-warning" key={i}>
                    <ShieldAlert size={16} />
                    <p>{warning}</p>
                  </div>
                ))}
                {invoice.state.extraction.pages.map((page) => (
                  <details key={page.page}>
                    <summary>Page {page.page}: extracted text</summary>
                    <pre>
                      {page.text || "No text could be read from this page."}
                    </pre>
                  </details>
                ))}
                <details className="technical-detail">
                  <summary>Extraction method and original values</summary>
                  <dl className="summary-list">
                    <div>
                      <dt>Method</dt>
                      <dd>{invoice.state.extraction.provider}</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>{invoice.state.extraction.version}</dd>
                    </div>
                  </dl>
                  <pre>
                    {JSON.stringify(
                      {
                        original: invoice.state.extraction.originalValues,
                        normalized: invoice.state.extraction.fields,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            </Panel>
          )}
        </div>
        <div className="review-column">
          <Panel title="Invoice details">
            {f ? (
              <dl className="field-grid">
                {Object.entries({
                  Supplier: f.supplierName,
                  "Supplier identifier": f.supplierId,
                  "Invoice number": f.invoiceNumber,
                  "Invoice date": f.invoiceDate,
                  Currency: f.currency,
                  "Purchase order": invoice.state.selectedPo ?? f.poReference,
                  Subtotal: f.subtotal ? money(f.subtotal, f.currency) : null,
                  Tax: f.tax ? money(f.tax, f.currency) : null,
                  Total: f.total ? money(f.total, f.currency) : null,
                }).map(([key, value]) => (
                  <div
                    className={key === "Total" ? "field-total" : ""}
                    key={key}
                  >
                    <dt>{key}</dt>
                    <dd
                      className={
                        ["Total", "Tax", "Subtotal"].includes(key)
                          ? "numeric"
                          : ""
                      }
                    >
                      {value ?? (
                        <span className="missing-value">
                          Needs verification
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="panel-body muted">
                Fields will appear when the document has been read.
              </div>
            )}
            {vendor && (
              <div className="matched-supplier">
                <ShieldCheck size={18} />
                <div>
                  <strong>{vendor.name}</strong>
                  <p>
                    {vendor.approved
                      ? "Approved supplier"
                      : "Supplier is not approved"}{" "}
                    · {vendor.identifier}
                  </p>
                </div>
              </div>
            )}
          </Panel>
          <ReviewPanel
            key={invoice.id}
            invoice={invoice}
            refs={refs}
            onAction={onAction}
            busy={busy}
            error={error}
          />
          <Balance invoice={invoice} refs={refs} />
        </div>
      </div>
      {e && <Checks findings={e.findings} />}
      <Panel
        title="Audit history"
        className="audit-panel"
        action={
          <span className="small-label">
            {invoice.state.history.length} recorded actions
          </span>
        }
      >
        <ol className="audit-list">
          {[...invoice.state.history].reverse().map((entry, i) => (
            <li key={i}>
              <span className="audit-node" />
              <div>
                <div className="audit-heading">
                  <h3>
                    {(
                      {
                        uploaded: "Invoice uploaded",
                        evaluated: "Recommendation saved",
                        correct: "Extracted details corrected",
                        "select-po": "Purchase order selected",
                        approve: "Invoice approved",
                        reject: "Invoice rejected",
                        "approve-requested": "Approval requested",
                        "reject-requested": "Rejection requested",
                        rerun: "Checks requested",
                        retry: "Processing retry requested",
                        recovered: "Interrupted run recovered",
                      } as Record<string, string>
                    )[entry.action] ?? "Review action recorded"}
                  </h3>
                  <span>Revision {entry.revision}</span>
                </div>
                <p>{entry.reason}</p>
                <small>
                  {date(entry.at)} ·{" "}
                  {entry.actor === "workspace reviewer"
                    ? "Historical shared reviewer (individual identity unavailable)"
                    : entry.actor}
                  {entry.correlationId && ` · ${entry.correlationId}`}
                </small>
                {(entry.previousFields !== undefined ||
                  entry.correctedFields !== undefined ||
                  entry.previousPo !== undefined) && (
                  <details>
                    <summary>View original and corrected values</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          original: entry.previousFields ?? entry.previousPo,
                          corrected: entry.correctedFields ?? entry.selectedPo,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
                {entry.evaluation && (
                  <details>
                    <summary>View saved evaluation</summary>
                    <pre>{JSON.stringify(entry.evaluation, null, 2)}</pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      <p className="workspace-footnote">
        {e
          ? "Policy " + e.policyVersion + " · Evaluated " + date(e.at)
          : "Recommendations and review actions are saved in this workspace."}
      </p>
    </>
  );
}
