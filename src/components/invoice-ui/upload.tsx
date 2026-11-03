"use client";
import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  FileText,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import type { Health } from "./presentation";
import { PageTitle } from "./ui";
export const scenarios = [
  {
    file: "happy-path.pdf",
    title: "Clean invoice",
    description: "Approved supplier, matching PO and reconciled total.",
    outcome: "Ready for approval",
    tag: "Standard review",
    amount: "INR 23,600.00",
  },
  {
    file: "duplicate-renamed.pdf",
    title: "Same invoice, different filename",
    description:
      "Process the clean invoice first. This identical copy must be blocked.",
    outcome: "Blocked",
    tag: "Duplicate",
    amount: "INR 23,600.00",
  },
  {
    file: "split-overbalance.pdf",
    title: "Split billing exceeds the PO",
    description:
      "INR 70,000 is committed against a INR 100,000 order. This invoice requests INR 40,000.",
    outcome: "Blocked",
    tag: "Balance control",
    amount: "INR 40,000.00",
  },
  {
    file: "scan-missing-total.pdf",
    title: "Scanned invoice with an unreadable total",
    description:
      "A real image-only PDF. The missing total needs a verified correction.",
    outcome: "Needs review",
    tag: "Scanned PDF",
    amount: "Total unreadable",
  },
  {
    file: "ambiguous-po.pdf",
    title: "Two eligible purchase orders",
    description:
      "No PO is supplied. Compare the two eligible orders before choosing.",
    outcome: "Needs review",
    tag: "PO selection",
    amount: "INR 11,800.00",
  },
];
export default function Upload({
  health,
  busy,
  onUpload,
  error,
  onClearError,
}: {
  health: Health | null;
  busy: boolean;
  onUpload: (file: File | string) => Promise<void>;
  error: string;
  onClearError: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null),
    [drag, setDrag] = useState(false),
    [validation, setValidation] = useState("");
  const maxMB = health?.limits.maxMB ?? 10,
    maxPages = health?.limits.maxPages ?? 10;
  function choose(next: File | undefined) {
    setValidation("");
    onClearError();
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".pdf")) {
      setValidation("Choose a PDF file. Other file types are not supported.");
      setFile(null);
      return;
    }
    if (next.size > maxMB * 1024 * 1024) {
      setValidation(
        `This file is too large. Choose a PDF no larger than ${maxMB} MB.`,
      );
      setFile(null);
      return;
    }
    setFile(next);
  }
  return (
    <>
      <PageTitle
        title="Upload an invoice"
        description="Start a review with a text PDF or a scanned invoice."
      />
      <div className="upload-grid">
        <section
          className="surface upload-surface"
          aria-labelledby="upload-title"
        >
          <div
            className={"drop-area " + (drag ? "dragging" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (!busy) choose(e.dataTransfer.files[0]);
            }}
          >
            <span className="upload-mark">
              <UploadCloud size={34} />
            </span>
            <h2 id="upload-title">Drop an invoice PDF here</h2>
            <p>Or select a file from your device.</p>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              Choose PDF
            </button>
            <input
              ref={input}
              type="file"
              aria-label="Invoice PDF"
              aria-describedby="upload-constraints upload-error"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <p id="upload-constraints" className="file-constraints">
              PDF only · Up to {maxMB} MB · Maximum {maxPages} pages
            </p>
          </div>
          {file && (
            <div className="selected-file">
              <span className="file-mark">
                <FileText size={22} />
              </span>
              <div>
                <strong>{file.name}</strong>
                <span>
                  {Math.max(1, Math.ceil(file.size / 1024)).toLocaleString(
                    "en-IN",
                  )}{" "}
                  KB · PDF document
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label="Remove selected file"
                onClick={() => {
                  setFile(null);
                  onClearError();
                }}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div
            id="upload-error"
            role="alert"
            className={validation || error ? "inline-error" : ""}
          >
            {validation || error}
          </div>
          <div className="upload-submit">
            <span>
              <ShieldCheck size={17} />
              Stored in your private workspace
            </span>
            <button
              className="button primary"
              disabled={!file || busy}
              onClick={() => file && void onUpload(file)}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <UploadCloud size={17} />
              )}{" "}
              {busy ? "Uploading…" : "Upload & process"}
            </button>
          </div>
        </section>
        <aside className="upload-guide">
          <h2>What happens next</h2>
          <ol>
            <li>
              <span>1</span>
              <div>
                <h3>Read the invoice</h3>
                <p>
                  Extract the details, using text recognition for scanned pages.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>Check the full picture</h3>
                <p>
                  Verify the supplier, totals, purchase order, duplicates and
                  available balance.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>Review the recommendation</h3>
                <p>
                  See the evidence and resolve any missing or uncertain details.
                </p>
              </div>
            </li>
          </ol>
          <div className="guidance-note">
            <ShieldCheck size={18} />
            <p>
              You stay in control. A recommendation does not approve an invoice
              or make a payment.
            </p>
          </div>
          {health?.worker === "offline" && (
            <div className="notice caution">
              <p>
                Processing is currently unavailable. You can upload now; the
                review will start when processing resumes.
              </p>
            </div>
          )}
        </aside>
      </div>
      {health?.environment !== "production" && (
        <section className="sample-section" aria-labelledby="samples-title">
          <div className="section-title">
            <div>
              <h2 id="samples-title">Try a sample invoice</h2>
              <p>
                Synthetic demo documents processed through the same upload and
                review flow.
              </p>
            </div>
            <a
              className="text-button"
              href="/api/samples/reference-records.json"
            >
              <ArrowDownToLine size={16} />
              Reference dataset
            </a>
          </div>
          <div className="surface sample-list">
            {scenarios.map((s) => (
              <article className="sample-row" key={s.file}>
                <span className="file-mark">
                  <FileText size={21} />
                </span>
                <div className="sample-description">
                  <span className="sample-tag">{s.tag}</span>
                  <h3>{s.title}</h3>
                  <p>{s.description}</p>
                </div>
                <div className="sample-expected">
                  <span className="numeric">{s.amount}</span>
                  <small>Expected: {s.outcome}</small>
                </div>
                <div className="sample-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void onUpload(s.file)}
                  >
                    Process sample
                  </button>
                  <a
                    className="icon-button"
                    href={"/api/samples/" + s.file}
                    aria-label={"Download " + s.title}
                  >
                    <ArrowDownToLine size={18} />
                  </a>
                </div>
              </article>
            ))}
          </div>
          <p className="workspace-footnote">
            <Check size={14} />
            Demo buttons upload actual PDFs. Repeated copies are correctly
            flagged as duplicates.
          </p>
        </section>
      )}
    </>
  );
}
