"use client";
import { useState } from "react";
import { PageTitle } from "@/components/invoice-ui/ui";

type ReconciliationCase = {
  caseKey: string;
  invoiceId: string;
  operationId: string;
  explanation: string;
};
type Result = {
  scanned: number;
  repaired: number;
  openCases: ReconciliationCase[];
};
export default function ReconciliationAdmin() {
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(mode: "scan" | "repair") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Reconciliation failed.");
      setResult(data as Result);
      setMessage(
        mode === "repair"
          ? `${data.repaired} stale final review(s) repaired from Decision records.`
          : `Scanned ${data.scanned} invoices. ${data.openCases.length} unresolved case(s).`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-stack">
      <PageTitle
        title="Cross-service reconciliation"
        description="Decision owns financial reviews and commitments. A repair copies a committed final review into stale Workflow state; it never creates or releases a commitment."
      />
      <div className="panel">
        <div className="button-row">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run("scan")}
          >
            Scan service and document integrity
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void run("repair")}
          >
            Repair stale final reviews
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </div>
      {result && (
        <div className="panel">
          <h2>Open cases ({result.openCases.length})</h2>
          {result.openCases.length ? (
            <ul className="content-stack">
              {result.openCases.map((item) => (
                <li key={item.caseKey}>
                  <strong>Invoice {item.invoiceId}</strong>
                  <p>{item.explanation}</p>
                  <small>Operation {item.operationId}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No unresolved cases were found by this scan.</p>
          )}
        </div>
      )}
    </section>
  );
}
