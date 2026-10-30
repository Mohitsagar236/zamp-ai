"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UploadCloud,
  X,
  XCircle,
  ScanLine,
  Layers3,
  Activity,
  ExternalLink,
} from "lucide-react";
import type { Fields, Invoice, PO, Vendor } from "@/lib/types";
import { amount } from "@/lib/money";
type Refs = {
  vendors: Vendor[];
  pos: PO[];
  commitments: {
    invoiceId: string;
    poId: string;
    amountMinor: string;
    label: string;
  }[];
};
type Health = {
  database: string;
  worker: string;
  ocr: string;
  authMode: string;
  limits: { maxMB: number; maxPages: number };
  policy: { version: string; roundingMinor: number; reservation: string };
};
const labels: Record<string, string> = {
  READY_FOR_APPROVAL: "Ready for approval",
  NEEDS_REVIEW: "Needs review",
  BLOCKED: "Blocked",
  queued: "Queued",
  running: "Processing",
  failed: "Processing failed",
  completed: "Completed",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};
const date = (d: string | Date) =>
  new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api/" + path, {
    cache: "no-store",
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error ?? "Request failed");
  return body;
}
function Badge({ value }: { value: string }) {
  const good = [
      "READY_FOR_APPROVAL",
      "approved",
      "completed",
      "passed",
    ].includes(value),
    bad = ["BLOCKED", "failed", "rejected", "blocked"].includes(value);
  const Icon = good
    ? Check
    : bad
      ? XCircle
      : value === "running"
        ? LoaderCircle
        : CircleAlert;
  return (
    <span
      className={`badge ${good ? "green" : bad ? "red" : value === "queued" || value === "running" ? "blue" : "amber"}`}
    >
      <Icon size={13} className={value === "running" ? "spin" : ""} />
      {labels[value] ?? value.replaceAll("-", " ")}
    </span>
  );
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FileText size={26} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
const scenarios = [
  {
    file: "happy-path.pdf",
    title: "A clean invoice",
    description: "Approved supplier, matching PO and reconciled total.",
    tag: "Happy path",
    color: "green",
    amount: "INR 23,600",
  },
  {
    file: "duplicate-renamed.pdf",
    title: "Same invoice, new filename",
    description: "Upload the clean invoice first. This copy must be blocked.",
    tag: "Duplicate",
    color: "red",
    amount: "INR 23,600",
  },
  {
    file: "split-overbalance.pdf",
    title: "A PO at its limit",
    description: "INR 70,000 committed; the new invoice exceeds the balance.",
    tag: "Hard balance control",
    color: "red",
    amount: "INR 40,000",
  },
  {
    file: "scan-missing-total.pdf",
    title: "A scan with a missing total",
    description:
      "Real image-only PDF. OCR extracts it; a reviewer verifies the total.",
    tag: "OCR + correction",
    color: "amber",
    amount: "Total unreadable",
  },
  {
    file: "ambiguous-po.pdf",
    title: "Two possible purchase orders",
    description: "The supplier has two eligible orders. A reviewer chooses.",
    tag: "PO selection",
    color: "amber",
    amount: "INR 11,800",
  },
];
export default function Workspace() {
  const path = usePathname(),
    router = useRouter();
  const view = path.split("/")[1] || "dashboard",
    id = path.split("/")[2];
  const [rows, setRows] = useState<Invoice[]>([]),
    [refs, setRefs] = useState<Refs>({ vendors: [], pos: [], commitments: [] }),
    [health, setHealth] = useState<Health | null>(null),
    [current, setCurrent] = useState<Invoice | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [connection, setConnection] = useState(true),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState(""),
    [edit, setEdit] = useState<Fields | null>(null),
    [selectedPo, setSelectedPo] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [r, ref, h, c] = await Promise.all([
        api<Invoice[]>("invoices"),
        api<Refs>("references"),
        api<Health>("health"),
        id ? api<Invoice>("invoices/" + id) : Promise.resolve(null),
      ]);
      setRows(r);
      setRefs(ref);
      setHealth(h);
      setCurrent(c);
      setConnection(true);
    } catch (e) {
      setConnection(false);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    setLoading(true);
    setCurrent(null);
    setEdit(null);
    setReason("");
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [refresh]);
  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }
    if (file.size > (health?.limits.maxMB ?? 10) * 1024 * 1024) {
      setError(`The PDF must be ${health?.limits.maxMB ?? 10} MB or smaller.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await api<{ id: string }>("invoices", {
        method: "POST",
        body: form,
      });
      router.push("/invoices/" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function sample(file: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/samples/" + file);
      if (!res.ok)
        throw Error("Sample PDF is unavailable. Run npm run fixtures.");
      await upload(
        new File([await res.blob()], file, { type: "application/pdf" }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string) {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      await api("invoices/" + current.id + "/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, fields: edit, selectedPo }),
      });
      setEdit(null);
      setReason("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const metrics = {
    total: rows.length,
    progress: rows.filter((r) => ["queued", "running"].includes(r.status))
      .length,
    ready: rows.filter(
      (r) =>
        r.state.evaluation?.decision === "READY_FOR_APPROVAL" &&
        r.state.review !== "rejected",
    ).length,
    review: rows.filter(
      (r) =>
        r.state.evaluation?.decision === "NEEDS_REVIEW" &&
        r.state.review !== "rejected",
    ).length,
    blocked: rows.filter((r) => r.state.evaluation?.decision === "BLOCKED")
      .length,
  };
  const filtered = rows.filter((r) => {
    const f = r.state.fields;
    return (
      (filter === "all" ||
        r.state.evaluation?.decision === filter ||
        r.status === filter ||
        r.state.review === filter) &&
      [r.filename, f?.supplierName, f?.invoiceNumber, f?.poReference]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  const visible = filtered.slice((page - 1) * 8, page * 8);
  const nav = [
    { key: "dashboard", name: "Overview", icon: LayoutDashboard, href: "/" },
    {
      key: "upload",
      name: "Upload invoice",
      icon: UploadCloud,
      href: "/upload",
    },
    {
      key: "records",
      name: "Reference records",
      icon: FolderOpen,
      href: "/records",
    },
    {
      key: "policy",
      name: "Policy & readiness",
      icon: ShieldCheck,
      href: "/policy",
    },
  ];
  const e = current?.state.evaluation,
    f = current?.state.fields;
  const active = current && ["queued", "running"].includes(current.status);
  const finalized = current && current.state.review !== "pending";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <ScanLine size={24} />
          </span>
          Invoice<span className="brand-light">Lens</span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switch">
          <span className="avatar">AP</span>
          <div>
            <strong>Accounts payable</strong>
            <small>Assessment workspace</small>
          </div>
          <span className="dot" />
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              className={view === n.key ? "nav-link active" : "nav-link"}
              href={n.href}
              key={n.key}
            >
              <n.icon size={18} />
              {n.name}
              {n.key === "dashboard" && metrics.total > 0 && (
                <span className="nav-count">{metrics.total}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <Layers3 size={20} />
          </div>
          <strong>From PDF to a clear decision.</strong>
          <p>Every recommendation comes with its evidence.</p>
          <Link href="/upload">
            Explore demo scenarios <ArrowRight size={14} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <span
            className={`dot ${health?.worker === "ready" ? "" : "offline"}`}
          />
          <span>
            {health?.worker === "ready" ? "Worker connected" : "Worker offline"}
          </span>
          <small>AP-2026.1</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>
              {view === "invoices"
                ? "Invoice review"
                : (nav.find((n) => n.key === view)?.name ?? "Overview")}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-label">
              <span className="dot" />
              {health?.authMode === "basic"
                ? "Private workspace"
                : "Local demo"}
            </span>
            <span className="avatar small-avatar">MR</span>
          </div>
        </header>
        <main id="main-content">
          {!connection && (
            <div className="notice amber">
              <CircleAlert size={18} />
              Connection interrupted. Your runs are saved. Reconnecting…{" "}
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {error && (
            <div role="alert" className="notice red">
              <CircleAlert size={18} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR REVIEW DESK</div>
                  <h1>
                    Invoice overview<span className="heading-dot">.</span>
                  </h1>
                  <p>A clear view of every invoice, from upload to decision.</p>
                </div>
                <Link className="button primary" href="/upload">
                  <Plus size={17} />
                  Upload invoice
                </Link>
              </div>
              <div className="metrics">
                {[
                  {
                    name: "Total invoices",
                    value: metrics.total,
                    icon: FileText,
                    sub: "Across all runs",
                    color: "",
                  },
                  {
                    name: "In progress",
                    value: metrics.progress,
                    icon: Activity,
                    sub: "Being processed",
                    color: "blue",
                  },
                  {
                    name: "Ready for approval",
                    value: metrics.ready,
                    icon: FileCheck2,
                    sub: "Checks passed",
                    color: "green",
                  },
                  {
                    name: "Needs review",
                    value: metrics.review,
                    icon: CircleAlert,
                    sub: "Your attention needed",
                    color: "amber",
                  },
                  {
                    name: "Blocked",
                    value: metrics.blocked,
                    icon: ShieldCheck,
                    sub: "Policy control triggered",
                    color: "red",
                  },
                ].map((m) => (
                  <div className="metric" key={m.name}>
                    <div className="metric-label">
                      {m.name}
                      <m.icon size={17} className={m.color} />
                    </div>
                    <div className="metric-value">
                      {loading ? "—" : m.value}
                    </div>
                    <div className="metric-sub">
                      <span className={`dot ${m.color}`} />
                      {m.sub}
                    </div>
                  </div>
                ))}
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Recent invoices <span className="count">{rows.length}</span>
                  </h2>
                  <p>
                    Recommendations, evidence, and review history in one place.
                  </p>
                </div>
                <button
                  className="button subtle"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>
              <section className="panel table-panel">
                <div className="table-toolbar">
                  <div className="tabs">
                    <button
                      className={filter === "all" ? "selected" : ""}
                      onClick={() => {
                        setFilter("all");
                        setPage(1);
                      }}
                    >
                      All invoices
                    </button>
                    <button
                      className={filter === "NEEDS_REVIEW" ? "selected" : ""}
                      onClick={() => {
                        setFilter("NEEDS_REVIEW");
                        setPage(1);
                      }}
                    >
                      Needs attention <span>{metrics.review}</span>
                    </button>
                  </div>
                  <div className="table-tools">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search invoices"
                        placeholder="Search invoices…"
                        value={query}
                        onChange={(ev) => {
                          setQuery(ev.target.value);
                          setPage(1);
                        }}
                      />
                    </label>
                    <select
                      aria-label="Filter invoices"
                      value={filter}
                      onChange={(ev) => {
                        setFilter(ev.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="all">All statuses</option>
                      <option value="READY_FOR_APPROVAL">
                        Ready for approval
                      </option>
                      <option value="NEEDS_REVIEW">Needs review</option>
                      <option value="BLOCKED">Blocked</option>
                      <option value="running">Processing</option>
                      <option value="failed">Failed</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                </div>
                {loading ? (
                  <div className="loading">
                    <LoaderCircle className="spin" />
                    Loading your workspace…
                  </div>
                ) : filtered.length ? (
                  <>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>INVOICE / SUPPLIER</th>
                            <th>AMOUNT</th>
                            <th>RECOMMENDATION</th>
                            <th>REVIEW</th>
                            <th>RECEIVED</th>
                            <th>
                              <span className="sr-only">Open</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <Link
                                  className="invoice-cell"
                                  href={"/invoices/" + r.id}
                                >
                                  <span className="file-icon">
                                    <FileText size={19} />
                                  </span>
                                  <span>
                                    <strong>
                                      {r.state.fields?.invoiceNumber ??
                                        r.filename}
                                    </strong>
                                    <small>
                                      {r.state.fields?.supplierName ??
                                        "Extracting supplier details"}
                                    </small>
                                  </span>
                                </Link>
                              </td>
                              <td className="money">
                                {r.state.fields?.total &&
                                r.state.fields.currency
                                  ? `${r.state.fields.currency} ${r.state.fields.total}`
                                  : "—"}
                              </td>
                              <td>
                                <Badge
                                  value={
                                    r.status === "completed"
                                      ? (r.state.evaluation?.decision ??
                                        r.status)
                                      : r.status
                                  }
                                />
                              </td>
                              <td>
                                <span className="review-label">
                                  {labels[r.state.review]}
                                </span>
                              </td>
                              <td className="muted nowrap">
                                {date(r.createdAt)}
                              </td>
                              <td>
                                <Link
                                  className="icon-link"
                                  aria-label={"Open " + r.filename}
                                  href={"/invoices/" + r.id}
                                >
                                  <ArrowUpRight size={18} />
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="table-footer">
                      <span>
                        Showing {(page - 1) * 8 + 1}–
                        {Math.min(page * 8, filtered.length)} of{" "}
                        {filtered.length} invoices
                      </span>
                      <div>
                        <button
                          disabled={page === 1}
                          onClick={() => setPage((p) => p - 1)}
                          aria-label="Previous page"
                        >
                          <ArrowLeft size={15} />
                        </button>
                        <span>Page {page}</span>
                        <button
                          disabled={page * 8 >= filtered.length}
                          onClick={() => setPage((p) => p + 1)}
                          aria-label="Next page"
                        >
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <Empty
                    title={
                      query || filter !== "all"
                        ? "No matching invoices"
                        : "Your next clear decision starts here"
                    }
                    detail={
                      query || filter !== "all"
                        ? "Try a different search or status filter."
                        : "Upload an invoice PDF or try a sample to see the complete review workflow."
                    }
                  />
                )}
              </section>
              <div className="bottom-cards">
                <div className="intro-card">
                  <div className="intro-art">
                    <ScanLine size={35} />
                    <span className="art-check">
                      <Check size={14} />
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow">A COMPLETE AUDIT TRAIL</span>
                    <h3>See the why behind every decision.</h3>
                    <p>
                      Original documents, checks, and balance calculations stay
                      connected.
                    </p>
                  </div>
                  <Link
                    href="/policy"
                    className="round-link"
                    aria-label="View policies"
                  >
                    <ArrowUpRight size={20} />
                  </Link>
                </div>
                <Link href="/upload" className="try-card">
                  <span className="eyebrow">NEW TO INVOICELENS?</span>
                  <h3>
                    Take a sample for a spin <ArrowUpRight size={18} />
                  </h3>
                  <p>Five real PDFs. Five useful stories.</p>
                </Link>
              </div>
            </>
          )}
          {view === "upload" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">START A REVIEW</div>
                  <h1>
                    One PDF. The whole picture
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    Upload an invoice. We’ll extract the details and check them
                    against your records.
                  </p>
                </div>
              </div>
              <div className="upload-layout">
                <section
                  className={`panel dropzone ${drag ? "dragging" : ""}`}
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    setDrag(false);
                    const file = ev.dataTransfer.files[0];
                    if (file && !busy) void upload(file);
                  }}
                >
                  <div className="upload-icon">
                    <UploadCloud size={34} />
                  </div>
                  <h2>
                    {busy
                      ? "Registering your invoice…"
                      : "Drop your invoice here"}
                  </h2>
                  <p>Text PDFs and scanned invoices are welcome.</p>
                  <button
                    className="button primary"
                    onClick={() => input.current?.click()}
                    disabled={busy}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Plus size={16} />
                    )}
                    Choose PDF
                  </button>
                  <input
                    ref={input}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    aria-label="Invoice PDF"
                    onChange={(ev) => {
                      const file = ev.target.files?.[0];
                      if (file) void upload(file);
                    }}
                  />
                  <small>
                    PDF only · Up to {health?.limits.maxMB ?? 10} MB · Maximum{" "}
                    {health?.limits.maxPages ?? 10} pages
                  </small>
                  <div className="private-note">
                    <ShieldCheck size={15} />
                    Your documents stay in this private workspace.
                  </div>
                </section>
                <section className="upload-explainer">
                  <div className="eyebrow">WHAT HAPPENS NEXT</div>
                  {[
                    {
                      n: "01",
                      title: "Read the document",
                      text: "Extract invoice details, using OCR for scanned pages.",
                    },
                    {
                      n: "02",
                      title: "Check the full picture",
                      text: "Match the supplier and PO, reconcile totals, and check past commitments.",
                    },
                    {
                      n: "03",
                      title: "Make the next step clear",
                      text: "Get an explained recommendation with the evidence to act.",
                    },
                  ].map((x) => (
                    <div className="explain-step" key={x.n}>
                      <span>{x.n}</span>
                      <div>
                        <h3>{x.title}</h3>
                        <p>{x.text}</p>
                      </div>
                    </div>
                  ))}
                  <div className="notice">
                    Recommendations support your review. No payments are made.
                  </div>
                </section>
              </div>
              <div className="section-heading">
                <div>
                  <h2>Try a real-world scenario</h2>
                  <p>
                    These sample PDFs go through the same upload and processing
                    pipeline.
                  </p>
                </div>
                <a
                  className="text-link"
                  href="/api/samples/reference-records.json"
                >
                  <ArrowDownToLine size={15} />
                  Reference dataset
                </a>
              </div>
              <div className="scenario-grid">
                {scenarios.map((s, i) => (
                  <section className="panel scenario" key={s.file}>
                    <div className="scenario-top">
                      <span className="scenario-number">0{i + 1}</span>
                      <span className={"badge " + s.color}>{s.tag}</span>
                    </div>
                    <h3>{s.title}</h3>
                    <p>{s.description}</p>
                    <div className="scenario-amount">{s.amount}</div>
                    <div className="scenario-actions">
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void sample(s.file)}
                      >
                        Process sample <ArrowRight size={14} />
                      </button>
                      <a
                        href={"/api/samples/" + s.file}
                        aria-label={"Download " + s.title}
                      >
                        <ArrowDownToLine size={17} />
                      </a>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
          {view === "invoices" &&
            (loading && !current ? (
              <div className="loading">
                <LoaderCircle className="spin" />
                Loading invoice…
              </div>
            ) : current ? (
              <>
                <Link className="back-link" href="/">
                  <ArrowLeft size={15} />
                  All invoices
                </Link>
                <div className="page-heading detail-heading">
                  <div>
                    <div className="eyebrow">
                      INVOICE REVIEW · REVISION {current.state.revision}
                    </div>
                    <h1>{f?.invoiceNumber ?? current.filename}</h1>
                    <p>
                      {f?.supplierName ?? "Reading supplier details"}{" "}
                      <span className="separator">/</span> Received{" "}
                      {date(current.createdAt)}
                    </p>
                  </div>
                  <div className="heading-actions">
                    <Badge
                      value={
                        current.status === "completed"
                          ? (e?.decision ?? "completed")
                          : current.status
                      }
                    />
                    <a
                      className="button"
                      href={"/api/invoices/" + current.id + "/document"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileText size={16} />
                      Original PDF <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
                <section className="panel process-panel">
                  <div className="panel-title">
                    <h2>
                      <Activity size={18} />
                      Processing timeline
                    </h2>
                    <span className="muted">
                      {active
                        ? "Live · updates automatically"
                        : "Persisted run history"}
                    </span>
                  </div>
                  <div className="stage-grid">
                    {current.state.stages.map((s, i) => (
                      <div className={"stage " + s.status} key={s.name}>
                        <div className="stage-symbol">
                          {s.status === "completed" ? (
                            <Check size={15} />
                          ) : s.status === "running" ? (
                            <LoaderCircle className="spin" size={15} />
                          ) : s.status === "failed" ? (
                            <X size={15} />
                          ) : (
                            <span>{i + 1}</span>
                          )}
                        </div>
                        <strong>{s.name}</strong>
                        <small>
                          {s.status}
                          {s.startedAt && s.endedAt
                            ? ` · ${((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000).toFixed(1)}s`
                            : s.startedAt && s.status === "running"
                              ? ` · ${Math.max(0, (Date.now() - new Date(s.startedAt).getTime()) / 1000).toFixed(1)}s elapsed`
                              : ""}
                        </small>
                        <p>{s.message ?? "Waiting for the previous stage."}</p>
                        {s.startedAt && <time>{date(s.startedAt)}</time>}
                      </div>
                    ))}
                  </div>
                </section>
                {current.state.error && (
                  <div className="notice red">
                    <XCircle size={20} />
                    <div>
                      <strong>We couldn’t process this document</strong>
                      <p>{current.state.error}</p>
                    </div>
                  </div>
                )}
                {e && (
                  <div
                    className={
                      "decision-banner " +
                      (e.decision === "READY_FOR_APPROVAL"
                        ? "green"
                        : e.decision === "BLOCKED"
                          ? "red"
                          : "amber")
                    }
                  >
                    <div className="decision-icon">
                      {e.decision === "READY_FOR_APPROVAL" ? (
                        <FileCheck2 size={27} />
                      ) : (
                        <CircleAlert size={27} />
                      )}
                    </div>
                    <div>
                      <div className="eyebrow">
                        AUTOMATED RECOMMENDATION · {e.policyVersion}
                      </div>
                      <h2>{labels[e.decision]}</h2>
                      <p>
                        {e.decision === "READY_FOR_APPROVAL"
                          ? "All required checks passed. Funds are reserved against the purchase order. Review and approve when ready."
                          : e.decision === "BLOCKED"
                            ? "A hard policy control was triggered. Resolve the underlying issue; approval cannot bypass this control."
                            : "Some details need your judgment. Inspect the evidence, make a verified correction, or select a purchase order."}
                      </p>
                    </div>
                  </div>
                )}
                <div className="detail-grid">
                  <div className="detail-main">
                    <section className="panel">
                      <div className="panel-title">
                        <h2>Invoice details</h2>
                        {f && !active && !finalized && (
                          <button
                            className="text-link"
                            onClick={() => setEdit({ ...f })}
                          >
                            Correct extracted data
                          </button>
                        )}
                      </div>
                      {f ? (
                        <div className="field-grid">
                          {Object.entries({
                            Supplier: f.supplierName,
                            "Supplier identifier": f.supplierId,
                            "Invoice number": f.invoiceNumber,
                            "Invoice date": f.invoiceDate,
                            "PO reference":
                              current.state.selectedPo ?? f.poReference,
                            Currency: f.currency,
                            Subtotal: f.subtotal,
                            Tax: f.tax,
                            Total: f.total,
                          }).map(([name, value]) => (
                            <div
                              className={name === "Total" ? "total-field" : ""}
                              key={name}
                            >
                              <small>{name}</small>
                              <strong>
                                {value ?? (
                                  <span className="missing">
                                    Missing / unreadable
                                  </span>
                                )}
                              </strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title="Waiting for extraction"
                          detail="The invoice fields will appear here when the worker reads the PDF."
                        />
                      )}
                    </section>
                    {e && (
                      <section className="panel">
                        <div className="panel-title">
                          <h2>Policy checks</h2>
                          <span className="muted">
                            {e.findings.length} findings
                          </span>
                        </div>
                        <div className="findings">
                          {e.findings.map((check, i) => (
                            <div className="finding" key={i}>
                              <span
                                className={
                                  "finding-icon " +
                                  (check.status === "passed"
                                    ? "green"
                                    : check.status === "blocked"
                                      ? "red"
                                      : "amber")
                                }
                              >
                                {check.status === "passed" ? (
                                  <Check size={16} />
                                ) : (
                                  <CircleAlert size={16} />
                                )}
                              </span>
                              <div>
                                <strong>
                                  {check.code
                                    .toLowerCase()
                                    .replaceAll("_", " ")}
                                </strong>
                                <p>{check.message}</p>
                                {check.evidence !== undefined && (
                                  <details>
                                    <summary>Supporting evidence</summary>
                                    <pre>
                                      {JSON.stringify(check.evidence, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                              <span className="check-state">
                                {check.status.replace("-", " ")}
                              </span>
                            </div>
                          ))}
                        </div>
                        {e.duplicateOf && (
                          <div className="panel-foot">
                            <Link
                              className="text-link"
                              href={"/invoices/" + e.duplicateOf}
                            >
                              View earlier invoice <ArrowUpRight size={14} />
                            </Link>
                          </div>
                        )}
                      </section>
                    )}
                    {current.state.extraction && (
                      <section className="panel">
                        <div className="panel-title">
                          <h2>Document evidence</h2>
                          <span className="muted">
                            {current.state.extraction.provider}
                          </span>
                        </div>
                        <div className="panel-body">
                          <p className="muted">
                            {current.state.extraction.version} ·{" "}
                            {current.state.extraction.pageCount} page(s).
                            Evidence is preserved separately from reviewer
                            corrections.
                          </p>
                          {current.state.extraction.warnings.map((w, i) => (
                            <p className="evidence-warning" key={i}>
                              <CircleAlert size={14} />
                              {w}
                            </p>
                          ))}
                          {current.state.extraction.pages.map((p) => (
                            <details key={p.page}>
                              <summary>Page {p.page} · extracted text</summary>
                              <pre>{p.text || "No readable text found."}</pre>
                            </details>
                          ))}
                          <details>
                            <summary>
                              Original and normalized extracted values
                            </summary>
                            <pre>
                              {JSON.stringify(
                                {
                                  original:
                                    current.state.extraction.originalValues,
                                  normalized: current.state.extraction.fields,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </div>
                      </section>
                    )}
                    <section className="panel">
                      <div className="panel-title">
                        <h2>Audit history</h2>
                        <span className="count">
                          {current.state.history.length}
                        </span>
                      </div>
                      <div className="audit-list">
                        {[...current.state.history].reverse().map((a, i) => (
                          <div className="audit-item" key={i}>
                            <span className="audit-dot" />
                            <div>
                              <strong>
                                {a.action.replaceAll("-", " ")}{" "}
                                <span>· revision {a.revision}</span>
                              </strong>
                              <p>{a.reason}</p>
                              <small>
                                {date(a.at)} · {a.actor}
                              </small>
                              {a.evaluation && (
                                <details>
                                  <summary>Evaluation snapshot</summary>
                                  <pre>
                                    {JSON.stringify(a.evaluation, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                  <aside className="detail-aside">
                    {e?.balance && (
                      <section className="panel balance-panel">
                        <div className="panel-title">
                          <h2>Purchase order balance</h2>
                        </div>
                        <div className="panel-body">
                          <Link href="/records" className="text-link">
                            {e.poId}
                            <ArrowUpRight size={14} />
                          </Link>
                          <p className="muted">
                            {refs.pos.find((p) => p.id === e.poId)?.description}
                          </p>
                          <dl>
                            {[
                              ["Order limit", e.balance.limit],
                              ["Prior commitments", e.balance.prior],
                              ["Available before invoice", e.balance.remaining],
                              ["This invoice impact", e.balance.impact],
                            ].map(([label, value]) => (
                              <div key={label}>
                                <dt>{label}</dt>
                                <dd>{amount(value, f?.currency ?? "INR")}</dd>
                              </div>
                            ))}
                          </dl>
                          {BigInt(e.balance.excess) > 0n ? (
                            <div className="balance-outcome red">
                              <strong>Over balance</strong>
                              <span>
                                {amount(e.balance.excess, f?.currency ?? "INR")}
                              </span>
                            </div>
                          ) : (
                            <div className="balance-outcome green">
                              <strong>After this invoice</strong>
                              <span>
                                {amount(
                                  BigInt(e.balance.remaining) -
                                    BigInt(e.balance.impact),
                                  f?.currency ?? "INR",
                                )}
                              </span>
                            </div>
                          )}
                          <small className="muted">
                            Hard balance limit · zero spending tolerance
                          </small>
                          {e.balance.commitments.length > 0 && (
                            <details>
                              <summary>Supporting prior invoices</summary>
                              {(
                                e.balance.commitments as {
                                  invoiceId: string;
                                  label: string;
                                  amountMinor: string;
                                }[]
                              ).map((c) => (
                                <p className="commitment" key={c.invoiceId}>
                                  {c.label}
                                  <strong>
                                    {amount(
                                      c.amountMinor,
                                      f?.currency ?? "INR",
                                    )}
                                  </strong>
                                </p>
                              ))}
                            </details>
                          )}
                        </div>
                      </section>
                    )}
                    <section className="panel review-panel">
                      <div className="panel-title">
                        <h2>Your review</h2>
                        <Badge value={current.state.review} />
                      </div>
                      <div className="panel-body">
                        {finalized ? (
                          <p>
                            This invoice was {current.state.review}. Its audit
                            history and recommendation are retained.
                          </p>
                        ) : active ? (
                          <p className="muted">
                            Review controls will be available when processing
                            finishes.
                          </p>
                        ) : (
                          <>
                            {e?.candidates && e.candidates.length > 1 && (
                              <label className="form-field">
                                Choose the verified purchase order
                                <select
                                  aria-label="Purchase order candidate"
                                  value={selectedPo}
                                  onChange={(ev) =>
                                    setSelectedPo(ev.target.value)
                                  }
                                >
                                  <option value="">Select an order…</option>
                                  {e.candidates.map((p) => (
                                    <option value={p} key={p}>
                                      {p} ·{" "}
                                      {
                                        refs.pos.find((x) => x.id === p)
                                          ?.description
                                      }
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {edit && (
                              <div className="edit-form">
                                <h3>Verified correction</h3>
                                <p>
                                  Check each change against the original PDF.
                                  Original extraction stays in the audit trail.
                                </p>
                                {Object.entries(edit)
                                  .filter(([k]) => k !== "lineItems")
                                  .map(([k, v]) => (
                                    <label className="form-field" key={k}>
                                      {k.replace(/([A-Z])/g, " $1")}
                                      <input
                                        value={typeof v === "string" ? v : ""}
                                        aria-label={"Correct " + k}
                                        onChange={(ev) =>
                                          setEdit({
                                            ...edit,
                                            [k]: ev.target.value || null,
                                          })
                                        }
                                      />
                                    </label>
                                  ))}
                                <button
                                  className="text-link"
                                  onClick={() => setEdit(null)}
                                >
                                  Cancel correction
                                </button>
                              </div>
                            )}
                            <label className="form-field">
                              Review reason{" "}
                              <span className="muted">(required)</span>
                              <textarea
                                rows={3}
                                placeholder="What did you verify or decide?"
                                value={reason}
                                onChange={(ev) => setReason(ev.target.value)}
                              />
                            </label>
                            <div className="review-buttons">
                              {edit ? (
                                <button
                                  className="button primary"
                                  disabled={busy || reason.trim().length < 5}
                                  onClick={() => void action("correct")}
                                >
                                  Save & re-run checks <RefreshCw size={15} />
                                </button>
                              ) : (
                                <>
                                  {selectedPo && (
                                    <button
                                      className="button primary"
                                      disabled={
                                        busy || reason.trim().length < 5
                                      }
                                      onClick={() => void action("select-po")}
                                    >
                                      Confirm PO & re-run
                                    </button>
                                  )}
                                  {e?.decision === "READY_FOR_APPROVAL" && (
                                    <button
                                      className="button primary"
                                      disabled={
                                        busy || reason.trim().length < 5
                                      }
                                      onClick={() => void action("approve")}
                                    >
                                      <CheckCheck size={16} />
                                      Approve invoice
                                    </button>
                                  )}
                                  <button
                                    className="button"
                                    disabled={busy || reason.trim().length < 5}
                                    onClick={() =>
                                      void action(
                                        current.status === "failed"
                                          ? "retry"
                                          : "rerun",
                                      )
                                    }
                                  >
                                    <RefreshCw size={15} />
                                    {current.status === "failed"
                                      ? "Retry processing"
                                      : "Re-run checks"}
                                  </button>
                                  <button
                                    className="button danger"
                                    disabled={busy || reason.trim().length < 5}
                                    onClick={() => void action("reject")}
                                  >
                                    Reject invoice
                                  </button>
                                </>
                              )}
                            </div>
                            <p className="review-hint">
                              <ShieldCheck size={14} />
                              Approval cannot bypass a hard control. No payment
                              is initiated.
                            </p>
                          </>
                        )}
                      </div>
                    </section>
                  </aside>
                </div>
              </>
            ) : (
              <Empty
                title="Invoice unavailable"
                detail="Return to the overview or check your connection."
              />
            ))}
          {view === "records" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">THE SOURCE OF TRUTH</div>
                  <h1>
                    Reference records<span className="heading-dot">.</span>
                  </h1>
                  <p>
                    The approved suppliers and purchase orders used in every
                    evaluation.
                  </p>
                </div>
                <a
                  className="button"
                  href="/api/samples/reference-records.json"
                >
                  <ArrowDownToLine size={16} />
                  Download dataset
                </a>
              </div>
              <div className="section-heading">
                <h2>
                  Suppliers <span className="count">{refs.vendors.length}</span>
                </h2>
              </div>
              <div className="vendor-grid">
                {refs.vendors.map((v) => (
                  <section className="panel vendor-card" key={v.id}>
                    <div className="vendor-top">
                      <span className="avatar">
                        {v.name
                          .split(" ")
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join("")}
                      </span>
                      <Badge value={v.approved ? "approved" : "BLOCKED"} />
                    </div>
                    <h3>{v.name}</h3>
                    <p className="mono muted">{v.identifier}</p>
                    <small>Registered aliases</small>
                    <p>{v.aliases.join(" · ")}</p>
                  </section>
                ))}
              </div>
              <div className="section-heading">
                <h2>
                  Purchase orders{" "}
                  <span className="count">{refs.pos.length}</span>
                </h2>
              </div>
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>PURCHASE ORDER</th>
                      <th>SUPPLIER</th>
                      <th>STATUS</th>
                      <th>LIMIT</th>
                      <th>COMMITTED</th>
                      <th>AVAILABLE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refs.pos.map((p) => {
                      const used = refs.commitments
                        .filter((c) => c.poId === p.id)
                        .reduce((s, c) => s + BigInt(c.amountMinor), 0n);
                      return (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.id}</strong>
                            <small className="table-sub">{p.description}</small>
                          </td>
                          <td>
                            {
                              refs.vendors.find((v) => v.id === p.vendorId)
                                ?.name
                            }
                          </td>
                          <td>
                            <span
                              className={
                                "badge " +
                                (p.status === "open" ? "green" : "red")
                              }
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="money">
                            {amount(p.limitMinor, p.currency)}
                          </td>
                          <td className="money">{amount(used, p.currency)}</td>
                          <td className="money">
                            {amount(BigInt(p.limitMinor) - used, p.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <section className="panel records-commitments">
                <div className="panel-title">
                  <h2>Linked commitments</h2>
                </div>
                <div className="panel-body">
                  {refs.commitments.map((c) => (
                    <div className="record-commitment" key={c.invoiceId}>
                      <span>{c.label}</span>
                      <span>{c.poId}</span>
                      <strong>
                        {amount(
                          c.amountMinor,
                          refs.pos.find((p) => p.id === c.poId)?.currency ??
                            "INR",
                        )}
                      </strong>
                      {c.invoiceId.startsWith("historical") ? (
                        <small>Imported approved invoice</small>
                      ) : (
                        <Link
                          className="text-link"
                          href={"/invoices/" + c.invoiceId}
                        >
                          Open invoice <ArrowUpRight size={13} />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {view === "policy" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">EXPLAINABLE BY DESIGN</div>
                  <h1>
                    Clear rules. Visible controls
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>How InvoiceLens turns evidence into a recommendation.</p>
                </div>
                <span className="badge blue">
                  <BookOpen size={14} />
                  {health?.policy.version ?? "AP-2026.1"}
                </span>
              </div>
              <div className="readiness-grid">
                {[
                  {
                    name: "Database",
                    value: health?.database ?? "Checking",
                    ok: health?.database === "ready",
                  },
                  {
                    name: "Processing worker",
                    value: health?.worker ?? "Checking",
                    ok: health?.worker === "ready",
                  },
                  {
                    name: "Scan extraction",
                    value:
                      health?.ocr === "tesseract"
                        ? "Tesseract · configured"
                        : "Disabled",
                    ok: health?.ocr === "tesseract",
                  },
                ].map((x) => (
                  <section className="panel readiness" key={x.name}>
                    <div
                      className={"finding-icon " + (x.ok ? "green" : "amber")}
                    >
                      {x.ok ? <Check size={19} /> : <CircleAlert size={19} />}
                    </div>
                    <div>
                      <small>{x.name}</small>
                      <strong>{x.value}</strong>
                    </div>
                  </section>
                ))}
              </div>
              <div className="policy-grid">
                {[
                  {
                    title: "Evidence before assumptions",
                    text: "Required invoice number, date, currency and total must be present. Supplier identity must match a registered identifier or exact approved alias. Missing details need review.",
                  },
                  {
                    title: "Exact money, explicit tolerance",
                    text: `Amounts use integer minor units. Subtotal + tax must match total within ${health?.policy.roundingMinor ?? 1} minor unit(s). No implicit currency conversion. Missing detailed lines are acceptable for bundled charges.`,
                  },
                  {
                    title: "A hard purchase order limit",
                    text: "An order must be open, belong to the supplier and use the invoice currency. Ready invoices reserve funds transactionally. Prior reserved and approved amounts count. Balance tolerance is zero.",
                  },
                  {
                    title: "One invoice, one allocation",
                    text: "Both file SHA-256 and normalized supplier/invoice-number identity detect duplicates. Renaming a PDF does not bypass checks. Retries and revisions never reserve the same invoice twice.",
                  },
                  {
                    title: "Your judgment, with an audit trail",
                    text: "Corrections and PO selections require a reason and trigger all checks again. Original extraction is retained. Approve requires a ready recommendation; reject releases reserved funds.",
                  },
                  {
                    title: "The strongest finding wins",
                    text: "A definite policy violation blocks the invoice. Otherwise, missing information or ambiguity requires review. Only invoices with all required checks passed become ready for approval.",
                  },
                ].map((x, i) => (
                  <section className="panel policy-card" key={x.title}>
                    <span className="scenario-number">0{i + 1}</span>
                    <h2>{x.title}</h2>
                    <p>{x.text}</p>
                  </section>
                ))}
              </div>
              <div className="notice">
                <ShieldCheck size={20} />
                <div>
                  <strong>Built for a single-workspace assessment</strong>
                  <p>
                    Recommendations do not initiate payments. This label-based
                    extractor needs verification for unfamiliar layouts. OCR
                    readiness here indicates configuration; verify actual
                    extraction with the scanned sample. Enable authenticated
                    HTTPS access before exposing invoice data publicly.
                  </p>
                </div>
              </div>
            </>
          )}
          <footer className="footer">
            <span>
              <ScanLine size={14} />
              InvoiceLens <span className="muted">/</span> A little clarity for
              accounts payable.
            </span>
            <span>Recommendations, never payments.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
