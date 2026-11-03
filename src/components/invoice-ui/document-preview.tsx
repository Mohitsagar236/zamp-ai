"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function DocumentPreview({ invoiceId }: { invoiceId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 641px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    // Mobile uses the original-file link instead of downloading a hidden preview.
    if (!desktop) return;
    let alive = true;
    let destroy: (() => void) | undefined;
    async function render() {
      try {
        setLoading(true);
        setError("");
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({
          url: "/api/invoices/" + invoiceId + "/document",
        });
        destroy = () => {
          void task.destroy();
        };
        const document = await task.promise;
        if (!alive) return;
        setCount(document.numPages);
        const source = await document.getPage(page);
        const target = canvas.current;
        if (!target || !alive) return;
        const viewport = source.getViewport({ scale: 1.5 });
        target.width = viewport.width;
        target.height = viewport.height;
        await source.render({ canvas: target, viewport }).promise;
        if (alive) setLoading(false);
      } catch {
        if (alive) {
          setLoading(false);
          setError(
            "Preview unavailable. Use Open PDF to review the original document.",
          );
        }
      }
    }
    void render();
    return () => {
      alive = false;
      destroy?.();
    };
  }, [invoiceId, page, desktop]);
  return (
    <div className="pdf-preview">
      <div className="pdf-page-controls">
        <button
          className="icon-button"
          aria-label="Previous PDF page"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>{count ? `Page ${page} of ${count}` : "Original invoice"}</span>
        <button
          className="icon-button"
          aria-label="Next PDF page"
          disabled={page >= count || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      {loading && (
        <p role="status" className="pdf-message">
          Loading document preview…
        </p>
      )}
      {error && (
        <p role="status" className="pdf-message">
          {error}
        </p>
      )}
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Original invoice PDF, page ${page}. Use Open PDF for the original document.`}
        hidden={loading || !!error}
      />
    </div>
  );
}
