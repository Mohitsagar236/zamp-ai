"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Minus,
  ShieldAlert,
  X,
  XCircle,
  FileText,
  Inbox,
} from "lucide-react";
import { labels } from "./presentation";
export function Status({ value }: { value: string }) {
  const good = [
      "READY_FOR_APPROVAL",
      "approved",
      "completed",
      "passed",
    ].includes(value),
    bad = ["BLOCKED", "blocked", "rejected", "failed"].includes(value),
    active = ["running", "queued"].includes(value),
    neutral = ["pending", "skipped", "not-evaluated"].includes(value);
  const Icon = good
    ? CheckCircle2
    : bad
      ? XCircle
      : active
        ? value === "running"
          ? LoaderCircle
          : Clock3
        : neutral
          ? Minus
          : ShieldAlert;
  return (
    <span
      className={`status-pill ${good ? "positive" : bad ? "negative" : active ? "informative" : neutral ? "neutral" : "caution"}`}
    >
      <Icon
        size={14}
        aria-hidden="true"
        className={value === "running" ? "spin" : ""}
      />
      {labels[value] ?? value}
    </span>
  );
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
  className = "",
  id,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={"surface " + className} id={id}>
      {title && (
        <div className="surface-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  title,
  description,
  action,
  search = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  search?: boolean;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark">
        {search ? <Inbox size={28} /> : <FileText size={28} />}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      {label}
    </div>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      ref.current?.showModal();
      ref.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    } else if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
      const target = returnFocus.current;
      queueMicrotask(() => {
        if (target?.isConnected) target.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"dialog " + (wide ? "dialog-wide" : "")}
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-description"}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <div>
          <h2 id={id + "-title"}>{title}</h2>
          <p id={id + "-description"}>{description}</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  action,
  onClose,
  onConfirm,
  busy,
  invoice,
  amount,
  po,
  error,
}: {
  action: "approve" | "reject" | null;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  invoice: string;
  amount: string;
  po?: string | null;
  error?: string;
}) {
  return (
    <Dialog
      open={!!action}
      onClose={onClose}
      title={
        action === "approve" ? "Approve this invoice?" : "Reject this invoice?"
      }
      description={
        action === "approve"
          ? "This records your review. It does not initiate a payment."
          : "This records a rejection and releases any funds reserved for this invoice."
      }
    >
      <div className="dialog-body">
        <dl className="summary-list">
          <div>
            <dt>Invoice</dt>
            <dd>{invoice}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd className="numeric">{amount}</dd>
          </div>
          {po && (
            <div>
              <dt>Purchase order</dt>
              <dd>{po}</dd>
            </div>
          )}
        </dl>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <p>
          Your review reason will be saved in the audit history. Finalized
          reviews cannot be edited in this interface.
        </p>
      </div>
      <div className="dialog-actions">
        <button
          data-initial-focus
          className="button"
          onClick={onClose}
          disabled={busy}
        >
          Keep reviewing
        </button>
        <button
          className={
            "button " + (action === "approve" ? "primary" : "destructive")
          }
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : action === "approve" ? (
            <Check size={16} />
          ) : (
            <XCircle size={16} />
          )}{" "}
          {action === "approve" ? "Confirm approval" : "Confirm rejection"}
        </button>
      </div>
    </Dialog>
  );
}
