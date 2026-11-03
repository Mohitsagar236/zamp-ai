"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import type { Invoice } from "@/lib/types";
import { attention, date, isActive, money, openDecision } from "./presentation";
import { Empty, Loading, PageTitle, Status } from "./ui";
export default function Overview({
  rows,
  loading,
  onRefresh,
}: {
  rows: Invoice[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1);
  const counts = {
    all: rows.length,
    processing: rows.filter(isActive).length,
    READY_FOR_APPROVAL: rows.filter((r) =>
      openDecision(r, "READY_FOR_APPROVAL"),
    ).length,
    NEEDS_REVIEW: rows.filter((r) => openDecision(r, "NEEDS_REVIEW")).length,
    BLOCKED: rows.filter((r) => openDecision(r, "BLOCKED")).length,
  };
  const setStatus = (value: string) => {
    setFilter(value);
    setPage(1);
  };
  const filtered = rows.filter((r) => {
    const f = r.state.fields;
    const matches = query.toLowerCase().trim();
    return (
      [
        r.filename,
        f?.supplierName,
        f?.invoiceNumber,
        f?.poReference,
        r.state.selectedPo,
      ]
        .join(" ")
        .toLowerCase()
        .includes(matches) &&
      (filter === "all" ||
        (filter === "processing" && isActive(r)) ||
        (filter === "failed" && r.status === "failed") ||
        (["approved", "rejected"].includes(filter) &&
          r.state.review === filter) ||
        openDecision(r, filter))
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 8)),
    currentPage = Math.min(page, pages),
    visible = filtered.slice((currentPage - 1) * 8, currentPage * 8);
  const items = [
    { key: "all", label: "Total invoices" },
    { key: "processing", label: "Processing" },
    { key: "READY_FOR_APPROVAL", label: "Ready for approval" },
    { key: "NEEDS_REVIEW", label: "Needs review" },
    { key: "BLOCKED", label: "Blocked" },
  ] as const;
  return (
    <>
      <PageTitle
        title="Invoices"
        description="Review exceptions. Keep every decision connected to its evidence."
        action={
          <Link className="button primary" href="/upload">
            <Plus size={18} />
            Upload invoice
          </Link>
        }
      />
      <div className="counts-bar" aria-label="Invoice status filters">
        {items.map((item) => (
          <button
            aria-pressed={filter === item.key}
            className={filter === item.key ? "selected" : ""}
            key={item.key}
            onClick={() => setStatus(item.key)}
          >
            <span>{item.label}</span>
            <strong className="numeric">
              {loading ? "—" : counts[item.key]}
            </strong>
          </button>
        ))}
      </div>
      {counts.NEEDS_REVIEW > 0 && (
        <div className="attention-strip">
          <ShieldAlert size={20} />
          <div>
            <strong>
              {counts.NEEDS_REVIEW}{" "}
              {counts.NEEDS_REVIEW === 1 ? "invoice needs" : "invoices need"}{" "}
              your review
            </strong>
            <span>Verify missing details or choose a purchase order.</span>
          </div>
          <button
            className="text-button"
            onClick={() => setStatus("NEEDS_REVIEW")}
          >
            View review queue <ChevronRight size={16} />
          </button>
        </div>
      )}
      <section
        className="surface invoice-ledger"
        aria-labelledby="ledger-title"
      >
        <div className="ledger-heading">
          <div>
            <h2 id="ledger-title">Invoice register</h2>
            <p>
              Recommendations and your review decisions are shown separately.
            </p>
          </div>
          <button className="button quiet" onClick={onRefresh}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        <div className="ledger-toolbar">
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search invoices</span>
            <input
              type="search"
              aria-label="Search invoices"
              placeholder="Search supplier, invoice or PO"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setPage(1);
                }}
              >
                <X size={16} />
              </button>
            )}
          </label>
          <label className="filter-field">
            <span>Status</span>
            <select
              aria-label="Filter invoices"
              value={filter}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All invoices</option>
              <option value="NEEDS_REVIEW">Needs review</option>
              <option value="BLOCKED">Blocked</option>
              <option value="READY_FOR_APPROVAL">Ready for approval</option>
              <option value="processing">Processing</option>
              <option value="failed">Processing failed</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
        {loading ? (
          <Loading />
        ) : visible.length ? (
          <>
            <div className="desktop-ledger table-scroll">
              <table>
                <caption className="sr-only">
                  Invoices with separate automated recommendations and human
                  review decisions
                </caption>
                <thead>
                  <tr>
                    <th>Invoice / supplier</th>
                    <th className="align-right">Amount</th>
                    <th>Recommendation</th>
                    <th>Human review</th>
                    <th>Received</th>
                    <th>
                      <span className="sr-only">Open invoice</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          className="invoice-identity"
                          href={"/invoices/" + r.id}
                        >
                          <span className="file-mark">
                            <FileText size={19} />
                          </span>
                          <span>
                            <strong>
                              {r.state.fields?.invoiceNumber ?? r.filename}
                            </strong>
                            <span>
                              {r.state.fields?.supplierName ??
                                "Supplier not yet available"}
                            </span>
                            <small>
                              {isActive(r) || r.status === "failed" ? (
                                <Status value={r.status} />
                              ) : (
                                attention(r)
                              )}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td className="align-right numeric amount-cell">
                        {r.state.fields?.total ? (
                          money(r.state.fields.total, r.state.fields.currency)
                        ) : (
                          <span className="muted">Total missing</span>
                        )}
                      </td>
                      <td>
                        {r.state.evaluation ? (
                          <Status value={r.state.evaluation.decision} />
                        ) : (
                          <span className="muted">Not available yet</span>
                        )}
                      </td>
                      <td>
                        <Status value={r.state.review} />
                      </td>
                      <td className="date-cell">
                        <time dateTime={new Date(r.createdAt).toISOString()}>
                          {date(r.createdAt)}
                        </time>
                      </td>
                      <td>
                        <Link
                          href={"/invoices/" + r.id}
                          className="icon-button"
                          aria-label={"Open " + r.filename}
                        >
                          <ArrowUpRight size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-ledger">
              {visible.map((r) => (
                <Link
                  className="mobile-invoice"
                  href={"/invoices/" + r.id}
                  key={r.id}
                >
                  <div className="mobile-invoice-top">
                    <strong>
                      {r.state.fields?.invoiceNumber ?? r.filename}
                    </strong>
                    <ArrowUpRight size={18} />
                  </div>
                  <p>
                    {r.state.fields?.supplierName ??
                      "Supplier not yet available"}
                  </p>
                  <div className="mobile-invoice-amount numeric">
                    {r.state.fields?.total
                      ? money(r.state.fields.total, r.state.fields.currency)
                      : "Total missing"}
                  </div>
                  <div className="mobile-statuses">
                    <Status value={r.state.evaluation?.decision ?? r.status} />
                    <span>
                      Review:{" "}
                      {r.state.review === "pending"
                        ? "not reviewed"
                        : r.state.review}
                    </span>
                  </div>
                  <small>{attention(r)}</small>
                </Link>
              ))}
            </div>
            <div className="pagination">
              <span>
                {(currentPage - 1) * 8 + 1}–
                {Math.min(currentPage * 8, filtered.length)} of{" "}
                {filtered.length} invoices
              </span>
              <div>
                <button
                  className="icon-button"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  Page {currentPage} of {pages}
                </span>
                <button
                  className="icon-button"
                  disabled={currentPage >= pages}
                  onClick={() => setPage(currentPage + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            search={!!query || filter !== "all"}
            title={
              query || filter !== "all"
                ? "No invoices match your search"
                : "Your invoice register is ready"
            }
            description={
              query || filter !== "all"
                ? "Try another supplier, invoice number or status."
                : "Upload an invoice PDF to review its details, checks and recommendation."
            }
            action={
              query || filter !== "all" ? (
                <button
                  className="button"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <Link className="button primary" href="/upload">
                  <Plus size={17} />
                  Upload your first invoice
                </Link>
              )
            }
          />
        )}
      </section>
      <p className="workspace-footnote">
        Ready for approval is a recommendation. Payments are not initiated in
        this workspace.
      </p>
    </>
  );
}
