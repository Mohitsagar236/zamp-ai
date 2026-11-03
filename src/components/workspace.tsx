"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  FolderOpen,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  RefreshCw,
  RotateCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Fields, Invoice } from "@/lib/types";
import { authClient } from "@/lib/auth-client";
import UserAdmin from "@/components/user-admin";
import AccountSettings from "@/components/account-settings";
import ReferenceAdmin from "@/components/reference-admin";
import ReconciliationAdmin from "@/components/reconciliation-admin";
import Overview from "./invoice-ui/overview";
import Upload from "./invoice-ui/upload";
import InvoiceDetail from "./invoice-ui/detail";
import { ReferenceRecords, Policy } from "./invoice-ui/references-policy";
import { Empty, Loading, PageTitle } from "./invoice-ui/ui";
import {
  labels,
  type Health,
  type References,
  type ReviewAction,
} from "./invoice-ui/presentation";
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api/" + path, {
    cache: "no-store",
    ...options,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("The workspace did not return a readable response. Try again.");
  }
  if (!response.ok)
    throw Error(data.error ?? "This request could not be completed.");
  return data;
}
export default function Workspace() {
  const path = usePathname(),
    router = useRouter(),
    view = path.split("/")[1] || "dashboard",
    id = view === "invoices" ? path.split("/")[2] : undefined;
  const [rows, setRows] = useState<Invoice[]>([]),
    [identity, setIdentity] = useState<{
      sub: string;
      email: string;
      name: string;
      role: string;
    } | null>(null),
    [refs, setRefs] = useState<References>({
      vendors: [],
      pos: [],
      commitments: [],
    }),
    [health, setHealth] = useState<Health | null>(null),
    [current, setCurrent] = useState<Invoice | null>(null),
    [loading, setLoading] = useState(true),
    [connected, setConnected] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false);
  const operation = useRef(false),
    refreshRef = useRef<() => Promise<void>>(async () => {}),
    pendingEvaluation = useRef<{ id: string; at?: string } | null>(null);
  useEffect(() => {
    let alive = true,
      fetching = false;
    setLoading(true);
    setCurrent(null);
    setError("");
    setToast("");
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const who = await api<typeof identity>("session").catch(() => null);
        const [r, reference, h, c] = await Promise.all([
          api<Invoice[]>("invoices"),
          api<References>("references"),
          api<Health>("health"),
          id ? api<Invoice>("invoices/" + id) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setRows(r);
        setIdentity(who);
        setRefs(reference);
        setHealth(h);
        setCurrent(c);
        setConnected(true);
        if (
          c &&
          pendingEvaluation.current?.id === c.id &&
          c.status === "completed" &&
          c.state.evaluation?.at !== pendingEvaluation.current.at
        ) {
          setToast(
            "Reevaluation complete: " +
              labels[c.state.evaluation?.decision ?? "completed"] +
              ".",
          );
          pendingEvaluation.current = null;
        }
      } catch {
        if (alive) setConnected(false);
      } finally {
        fetching = false;
        if (alive) setLoading(false);
      }
    }
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);
  async function upload(fileOrSample: File | string) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      let file: File;
      if (typeof fileOrSample === "string") {
        const response = await fetch("/api/samples/" + fileOrSample);
        if (!response.ok)
          throw Error(
            "This sample is unavailable. Choose another sample or upload your own PDF.",
          );
        file = new File([await response.blob()], fileOrSample, {
          type: "application/pdf",
        });
      } else file = fileOrSample;
      const maxMB = health?.limits.maxMB ?? 10;
      if (!file.name.toLowerCase().endsWith(".pdf"))
        throw Error("Choose a PDF file.");
      if (file.size > maxMB * 1024 * 1024)
        throw Error(`Choose a PDF no larger than ${maxMB} MB.`);
      const form = new FormData();
      form.set("file", file);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const storageKey = "invoicelens-upload:" + fingerprint + ":" + file.name;
      let operationId = crypto.randomUUID();
      try {
        const existing = sessionStorage.getItem(storageKey);
        if (existing) operationId = existing as typeof operationId;
        else sessionStorage.setItem(storageKey, operationId);
      } catch {
        /* Browser storage can be unavailable; server duplicate controls still apply. */
      }
      const result = await api<{ id: string }>("invoices", {
        method: "POST",
        body: form,
        headers: { "Idempotency-Key": operationId },
      });
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* No persistent browser storage. */
      }
      router.push("/invoices/" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function act(
    action: ReviewAction,
    reason: string,
    fields?: Fields,
    selectedPo?: string,
    verifiedExtraction?: boolean,
  ) {
    if (!current || operation.current) return false;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await api<Invoice>("invoices/" + current.id + "/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason,
          fields,
          selectedPo,
          verifiedExtraction,
        }),
      });
      if (action === "approve" || action === "reject") {
        setToast(
          action === "approve"
            ? "Approval request saved. Recommendation recording is pending."
            : "Rejection request saved. Recording is pending.",
        );
      } else {
        pendingEvaluation.current = {
          id: current.id,
          at: current.state.evaluation?.at,
        };
        setToast("Changes saved. Invoice checks are running again.");
      }
      await refreshRef.current();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  const nav = [
    { key: "dashboard", name: "Invoices", href: "/", icon: LayoutDashboard },
    { key: "upload", name: "Upload invoice", href: "/upload", icon: FileUp },
    {
      key: "records",
      name: "Reference records",
      href: "/records",
      icon: FolderOpen,
    },
    {
      key: "policy",
      name: "Policy and readiness",
      href: "/policy",
      icon: ShieldCheck,
    },
    ...(identity
      ? [
          {
            key: "account",
            name: "My account",
            href: "/account",
            icon: LockKeyhole,
          },
        ]
      : []),
    ...(identity?.role === "admin"
      ? [
          {
            key: "users",
            name: "Workspace accounts",
            href: "/users",
            icon: LockKeyhole,
          },
          {
            key: "reconciliation",
            name: "Reconciliation",
            href: "/reconciliation",
            icon: RotateCw,
          },
        ]
      : []),
  ];
  const selected = view === "invoices" ? "dashboard" : view;
  const needsReview = rows.filter(
    (r) =>
      r.state.review === "pending" &&
      r.status === "completed" &&
      r.state.evaluation?.decision === "NEEDS_REVIEW",
  ).length;
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="InvoiceLens home">
          <span className="brand-symbol">
            <ScanLine size={23} />
          </span>
          <span>InvoiceLens</span>
        </Link>
        <div className="workspace-identity">
          <span className="workspace-initials">AP</span>
          <div>
            <strong>Accounts payable</strong>
            <span>Invoice review workspace</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              title={n.name}
              aria-current={selected === n.key ? "page" : undefined}
              className={"nav-link " + (selected === n.key ? "active" : "")}
            >
              <n.icon size={19} />
              <span>{n.name}</span>
              {n.key === "dashboard" && needsReview > 0 && (
                <span
                  className="nav-count"
                  aria-label={needsReview + " needing review"}
                >
                  {needsReview}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-context">
          <ShieldCheck size={19} />
          <p>
            Every recommendation stays connected to its source and review
            history.
          </p>
        </div>
        <div className="processing-readiness">
          <span
            className={
              "readiness-dot " +
              (health?.worker === "ready" ? "available" : "unavailable")
            }
          />
          <span>
            {health
              ? health.worker === "ready"
                ? "Processing available"
                : "Processing unavailable"
              : "Checking processing…"}
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>
              {view === "invoices"
                ? "Invoice review"
                : (nav.find((n) => n.key === view)?.name ?? "Invoices")}
            </strong>
          </div>
          <span className="workspace-access">
            <LockKeyhole size={15} />
            {identity
              ? `${identity.name} · ${identity.role}`
              : health?.authMode === "basic"
                ? "Private workspace"
                : health?.authMode === "individual"
                  ? "Signed in"
                  : "Local demo workspace"}
          </span>
          {identity && (
            <button
              className="button button-secondary"
              onClick={async () => {
                await authClient.signOut();
                router.replace("/sign-in");
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          )}
        </header>
        <main id="main-content" tabIndex={-1}>
          {!connected && (
            <div className="notice caution connection-notice" role="status">
              <ShieldAlert size={20} />
              <div>
                <strong>Connection interrupted</strong>
                <p>Your saved runs are safe. Reconnecting automatically…</p>
              </div>
              <button
                className="button"
                onClick={() => void refreshRef.current()}
              >
                <RefreshCw size={16} />
                Retry connection
              </button>
            </div>
          )}
          {toast && (
            <div className="notice positive action-notice" role="status">
              <CheckCircle2 size={20} />
              <span>{toast}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setToast("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {view === "dashboard" && (
            <Overview
              rows={rows}
              loading={loading}
              onRefresh={() => void refreshRef.current()}
            />
          )}{" "}
          {view === "upload" && (
            <Upload
              health={health}
              busy={busy}
              error={error}
              onUpload={upload}
              onClearError={() => setError("")}
            />
          )}{" "}
          {view === "records" &&
            (loading ? (
              <Loading />
            ) : (
              <ReferenceRecords
                refs={refs}
                production={health?.environment === "production"}
              />
            ))}{" "}
          {view === "records" && identity?.role === "admin" && (
            <ReferenceAdmin />
          )}{" "}
          {view === "policy" && <Policy health={health} />}{" "}
          {view === "users" && identity?.role === "admin" && <UserAdmin />}{" "}
          {view === "account" && identity && <AccountSettings />}
          {view === "reconciliation" && identity?.role === "admin" && (
            <ReconciliationAdmin />
          )}{" "}
          {view === "invoices" &&
            (current ? (
              <InvoiceDetail
                invoice={current}
                refs={refs}
                onAction={act}
                busy={busy}
                error={error}
              />
            ) : loading ? (
              <>
                <PageTitle
                  title="Loading invoice"
                  description="Retrieving the saved document, checks and review history."
                />
                <Loading label="Loading invoice…" />
              </>
            ) : (
              <Empty
                title="Invoice unavailable"
                description="Check the address or your connection, then return to the invoice register."
                action={
                  <Link className="button" href="/">
                    <ArrowLeft size={16} />
                    All invoices
                  </Link>
                }
              />
            ))}{" "}
          {![
            "dashboard",
            "upload",
            "records",
            "policy",
            "invoices",
            "users",
          ].includes(view) && (
            <Empty
              title="Page not found"
              description="Return to the invoice register to continue reviewing."
              action={
                <Link className="button" href="/">
                  All invoices
                </Link>
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
