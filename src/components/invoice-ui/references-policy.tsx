import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { amount } from "@/lib/money";
import type { Health, References } from "./presentation";
import { Panel, PageTitle, Status } from "./ui";
export function ReferenceRecords({
  refs,
  production = false,
}: {
  refs: References;
  production?: boolean;
}) {
  return (
    <>
      <PageTitle
        title="Reference records"
        description="The suppliers, purchase orders and commitments used to evaluate invoices."
        action={
          !production && (
            <a className="button" href="/api/samples/reference-records.json">
              <ArrowDownToLine size={17} />
              Download demo dataset
            </a>
          )
        }
      />
      <Panel
        title="Suppliers"
        action={
          <span className="small-label">
            {refs.vendors.length} registered suppliers
          </span>
        }
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Registered identifier</th>
                <th>Approval</th>
                <th>Registered aliases</th>
              </tr>
            </thead>
            <tbody>
              {refs.vendors.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.name}</strong>
                  </td>
                  <td>{v.identifier}</td>
                  <td>
                    <Status value={v.approved ? "approved" : "BLOCKED"} />
                  </td>
                  <td className="alias-cell">{v.aliases.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="Purchase orders"
        className="records-panel"
        action={<span className="small-label">{refs.pos.length} orders</span>}
      >
        <p className="panel-intro">
          Commitments include prior approved invoices and funds reserved by
          ready recommendations.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Purchase order</th>
                <th>Supplier</th>
                <th>Eligibility</th>
                <th className="align-right">PO limit</th>
                <th className="align-right">Committed</th>
                <th className="align-right">Available</th>
              </tr>
            </thead>
            <tbody>
              {refs.pos.map((p) => {
                const used = refs.commitments
                  .filter((c) => c.poId === p.id)
                  .reduce((sum, c) => sum + BigInt(c.amountMinor), 0n);
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.id}</strong>
                      <span className="cell-secondary">{p.description}</span>
                    </td>
                    <td>
                      {refs.vendors.find((v) => v.id === p.vendorId)?.name}
                    </td>
                    <td>
                      <span
                        className={
                          "order-state " +
                          (p.status === "open" ? "positive" : "neutral")
                        }
                      >
                        <CheckCircle2 size={14} />
                        {p.status === "open"
                          ? "Open for invoicing"
                          : p.status === "closed"
                            ? "Closed"
                            : p.status}
                      </span>
                    </td>
                    <td className="numeric align-right">
                      {amount(p.limitMinor, p.currency)}
                    </td>
                    <td className="numeric align-right">
                      {amount(used, p.currency)}
                    </td>
                    <td className="numeric align-right">
                      {amount(BigInt(p.limitMinor) - used, p.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mobile-table-hint">
          Swipe within the table to compare order balances.
        </p>
      </Panel>
      <Panel title="Invoice commitments" className="records-panel">
        <div className="commitment-register">
          {refs.commitments.map((c) => (
            <div key={c.invoiceId}>
              <span className="file-mark">
                <FileText size={18} />
              </span>
              <div>
                <strong>{c.label}</strong>
                <span>{c.poId}</span>
              </div>
              <strong className="numeric">
                {amount(
                  c.amountMinor,
                  refs.pos.find((p) => p.id === c.poId)?.currency ?? "INR",
                )}
              </strong>
              {c.invoiceId.startsWith("historical") ? (
                <span className="small-label">Imported approval</span>
              ) : (
                <Link
                  className="icon-button"
                  href={"/invoices/" + c.invoiceId}
                  aria-label={"Open invoice " + c.label}
                >
                  <ArrowUpRight size={18} />
                </Link>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
export function Policy({ health }: { health: Health | null }) {
  const rules = [
    {
      title: "Verify required details",
      text: "An invoice number, valid date, currency and positive total are needed before an invoice can be ready. Missing or unclear values require review.",
    },
    {
      title: "Reconcile the amounts",
      text: `Subtotal and tax must match the total within ${health?.policy.roundingMinor ?? 1} minor unit(s). Currency precision is respected. There is no automatic currency conversion.`,
    },
    {
      title: "Match a registered supplier",
      text: "A supplier must match a registered identifier or an explicitly registered alias and be approved. Similar names alone are not proof of identity.",
    },
    {
      title: "Use an eligible purchase order",
      text: "The order must be open, belong to the supplier and use the same currency. If multiple orders are plausible, a reviewer chooses the verified order.",
    },
    {
      title: "Respect the remaining balance",
      text: "Ready recommendations reserve funds. Prior reserved and approved amounts count toward the PO limit. Rejected invoices release their reservation. Spending beyond the limit is never allowed.",
    },
    {
      title: "Prevent duplicate allocation",
      text: "Both identical document content and registered supplier/invoice-number identity are checked. A changed filename does not make an invoice new. Retries do not reserve the same invoice twice.",
    },
  ];
  return (
    <>
      <PageTitle
        title="Policy and readiness"
        description="Understand the controls behind each recommendation."
        action={
          <span className="policy-version">
            Policy {health?.policy.version ?? "AP-2026.1"}
          </span>
        }
      />
      <Panel title="Workspace readiness">
        <div className="readiness-list">
          {[
            {
              name: "Stored records",
              value: health?.database === "ready" ? "Available" : "Unavailable",
              good: health?.database === "ready",
              description: "Invoice history and reference data",
            },
            {
              name: "Invoice processing",
              value: health?.worker === "ready" ? "Available" : "Unavailable",
              good: health?.worker === "ready",
              description: "Processes queued invoices in the background",
            },
            {
              name: "Scanned documents",
              value:
                health?.ocr === "tesseract" ? "Configured" : "Not configured",
              good: health?.ocr === "tesseract",
              description: "Text recognition for image-only PDF pages",
            },
          ].map((item) => (
            <div key={item.name}>
              <span
                className={
                  "readiness-icon " + (item.good ? "positive" : "caution")
                }
              >
                <ShieldCheck size={22} />
              </span>
              <div>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
              </div>
              <span
                className={
                  "order-state " + (item.good ? "positive" : "caution")
                }
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
        <div className="panel-body technical-detail">
          <details>
            <summary>Configuration details</summary>
            <p>
              Scan provider: {health?.ocr ?? "Checking"}; workspace access:{" "}
              {health?.authMode === "basic" ? "authenticated" : "local only"}.
            </p>
            <p>
              Configured scan support does not prove a particular document can
              be read. Run a scanned sample to verify this workspace.
            </p>
          </details>
        </div>
      </Panel>
      <section className="policy-rules" aria-label="Invoice evaluation rules">
        {rules.map((rule) => (
          <article key={rule.title}>
            <ShieldCheck size={20} />
            <div>
              <h2>{rule.title}</h2>
              <p>{rule.text}</p>
            </div>
          </article>
        ))}
      </section>
      <Panel title="How findings become a recommendation">
        <div className="decision-guide">
          <div>
            <Status value="BLOCKED" />
            <p>
              A definite policy violation prevents approval. Hard controls
              cannot be overridden by the approve action.
            </p>
          </div>
          <div>
            <Status value="NEEDS_REVIEW" />
            <p>
              Missing information or unresolved ambiguity needs verified
              reviewer input.
            </p>
          </div>
          <div>
            <Status value="READY_FOR_APPROVAL" />
            <p>
              Required checks passed. A reviewer may record approval; no payment
              is initiated.
            </p>
          </div>
        </div>
      </Panel>
      <div className="notice informative policy-limits">
        <ShieldCheck size={22} />
        <div>
          <h2>Assessment workspace</h2>
          <p>
            The included extractor reads labelled English fields. Unfamiliar
            layouts and uncertain source values need careful verification. This
            workspace uses a shared reviewer identity and does not make
            payments.
          </p>
        </div>
      </div>
    </>
  );
}
