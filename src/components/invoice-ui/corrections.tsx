"use client";
import { useId, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { fieldsSchema, type Fields, type Invoice } from "@/lib/types";
import { Dialog } from "./ui";
const names: Record<Exclude<keyof Fields, "lineItems">, string> = {
  supplierName: "Supplier name",
  supplierId: "Supplier identifier",
  invoiceNumber: "Invoice number",
  invoiceDate: "Invoice date",
  poReference: "PO reference",
  currency: "Currency",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
};
export default function Corrections({
  invoice,
  onClose,
  onSave,
  busy,
  error,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSave: (
    fields: Fields,
    reason: string,
    verified: boolean,
  ) => Promise<boolean>;
  busy: boolean;
  error: string;
}) {
  const [fields, setFields] = useState<Fields>({ ...invoice.state.fields! }),
    [reason, setReason] = useState(""),
    [verified, setVerified] = useState(false),
    [invalid, setInvalid] = useState<Record<string, string>>({});
  const id = useId();
  const original = invoice.state.extraction;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = fieldsSchema.safeParse(fields);
    const issues: Record<string, string> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        issues[String(issue.path[0])] =
          "Check this value. Use YYYY-MM-DD for dates, three letters for currency, and plain numbers for amounts.";
    if (reason.trim().length < 5)
      issues.reason = "Add a verification reason of at least 5 characters.";
    setInvalid(issues);
    if (Object.keys(issues).length) return;
    if (await onSave(parsed.success ? parsed.data : fields, reason, verified))
      onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Correct extracted data"
      description="Verify changes against the original document. Original extracted values stay in the audit history."
      wide
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="dialog-body correction-body">
          <div className="correction-help">
            Leave an unreadable value blank. Missing required details will
            continue to need review.
          </div>
          <div className="correction-grid">
            {(Object.keys(names) as (keyof typeof names)[]).map((key) => (
              <label className="form-field" key={key} htmlFor={id + "-" + key}>
                <span>
                  {names[key]}
                  {!fields[key] && (
                    <span className="field-attention">Needs attention</span>
                  )}
                </span>
                <input
                  id={id + "-" + key}
                  aria-label={"Correct " + key}
                  value={fields[key] ?? ""}
                  inputMode={
                    ["subtotal", "tax", "total"].includes(key)
                      ? "decimal"
                      : undefined
                  }
                  maxLength={key === "currency" ? 3 : 200}
                  aria-invalid={!!invalid[key]}
                  aria-describedby={id + "-" + key + "-hint"}
                  readOnly={key === "poReference" && !!invoice.state.selectedPo}
                  placeholder="Not read from document"
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      [key]: e.target.value
                        ? key === "currency"
                          ? e.target.value.toUpperCase()
                          : e.target.value
                        : null,
                    })
                  }
                />
                <small id={id + "-" + key + "-hint"}>
                  {invalid[key] ??
                    (key === "poReference" && invoice.state.selectedPo
                      ? "This PO was selected during review. Use Change purchase order to update its assignment."
                      : `Original: ${original?.originalValues[key] ?? original?.fields[key] ?? "Not found"}`)}
                </small>
              </label>
            ))}
          </div>
          <fieldset className="form-field">
            <legend>Invoice items</legend>
            <p>
              Enter every item shown on the source. Leave empty only for a
              verified bundled charge.
            </p>
            {fields.lineItems.map((line, index) => (
              <div className="correction-grid" key={index}>
                {(
                  ["description", "quantity", "unitPrice", "amount"] as const
                ).map((key) => (
                  <label className="form-field" key={key}>
                    <span>
                      {key} · item {index + 1}
                    </span>
                    <input
                      aria-label={`Item ${index + 1} ${key}`}
                      value={line[key] ?? ""}
                      maxLength={key === "description" ? 500 : 30}
                      onChange={(event) =>
                        setFields({
                          ...fields,
                          lineItems: fields.lineItems.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  [key]:
                                    event.target.value ||
                                    (key === "description" || key === "quantity"
                                      ? ""
                                      : null),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    setFields({
                      ...fields,
                      lineItems: fields.lineItems.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove item {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button"
              disabled={fields.lineItems.length >= 200}
              onClick={() =>
                setFields({
                  ...fields,
                  lineItems: [
                    ...fields.lineItems,
                    {
                      description: "",
                      quantity: "1",
                      unitPrice: null,
                      amount: null,
                    },
                  ],
                })
              }
            >
              Add invoice item
            </button>
            {invalid.lineItems && <p role="alert">{invalid.lineItems}</p>}
          </fieldset>
          {
            <label>
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              {invoice.state.extraction?.provider.includes("Tesseract")
                ? "I checked all extracted values against the original scan."
                : "I checked all invoice values, item details and tax treatment against the original document."}
            </label>
          }
          <label className="form-field" htmlFor={id + "-reason"}>
            <span>
              Review reason <span className="required-hint">Required</span>
            </span>
            <textarea
              id={id + "-reason"}
              aria-label="Review reason"
              rows={3}
              value={reason}
              aria-invalid={!!invalid.reason}
              aria-describedby={id + "-reason-hint"}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Which source did you verify, and what did you correct?"
              required
              minLength={5}
            />
            <small id={id + "-reason-hint"}>
              {invalid.reason ??
                "Your reason, changes and verification time will be recorded."}
            </small>
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel correction
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || reason.trim().length < 5}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Save & re-run checks
          </button>
        </div>
      </form>
    </Dialog>
  );
}
