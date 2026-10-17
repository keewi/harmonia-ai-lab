"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Ported from harmonia-connect's components/music/pdf-viewer: fit-width, one page, ←/→ to turn. */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

type Loaded = { url: string; doc: PDFDocumentProxy | null; error: boolean };

export function PdfViewer({ url, fileName }: { url: string; fileName: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const doc = loaded?.url === url ? loaded.doc : null;
  const total = doc?.numPages ?? 0;
  const status: "loading" | "ready" | "error" = loaded?.url !== url ? "loading" : loaded.error || renderFailed ? "error" : "ready";

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        task = pdfjs.getDocument({ url });
        const d = await task.promise;
        if (cancelled) return;
        setRenderFailed(false);
        setPage(1);
        setLoaded({ url, doc: d, error: false });
      } catch {
        if (!cancelled) setLoaded({ url, doc: null, error: true });
      }
    })();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      void task?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || width <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
        renderTaskRef.current = task;
        await task.promise;
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (!cancelled && name !== "RenderingCancelledException") setRenderFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, width]);

  const go = useCallback((delta: number) => setPage((p) => (total ? Math.min(Math.max(1, p + delta), total) : p)), [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const ready = status === "ready";
  const arrow =
    "flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10";

  return (
    <div className="flex flex-col rounded-card bg-grey-900">
      <div className="flex items-start gap-2 p-3 md:gap-4 md:p-4">
        <button type="button" className={`${arrow} mt-[30vh] hidden sm:flex`} aria-label="Previous page" disabled={!ready || page <= 1} onClick={() => go(-1)}>
          <ChevronLeft size={20} aria-hidden />
        </button>
        <div ref={sheetRef} className="min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            className={ready ? "block w-full rounded-[4px] bg-white" : "hidden"}
            role="img"
            aria-label={`${fileName}, page ${page}${total ? ` of ${total}` : ""}`}
          />
          {!ready ? (
            <div className="flex aspect-[8.5/11] items-center justify-center rounded-[4px] bg-white text-sm text-grey-500" role="status">
              {status === "loading" ? "Loading…" : "Couldn't load this PDF"}
            </div>
          ) : null}
        </div>
        <button type="button" className={`${arrow} mt-[30vh] hidden sm:flex`} aria-label="Next page" disabled={!ready || page >= total} onClick={() => go(1)}>
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>
      <div className="flex h-12 items-center justify-center gap-4 text-[13px] text-white/75">
        <button type="button" className="rounded p-1 hover:text-white disabled:opacity-30 sm:hidden" aria-label="Previous page" disabled={!ready || page <= 1} onClick={() => go(-1)}>
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span aria-live="polite">{total ? `Page ${page} of ${total}` : fileName}</span>
        <button type="button" className="rounded p-1 hover:text-white disabled:opacity-30 sm:hidden" aria-label="Next page" disabled={!ready || page >= total} onClick={() => go(1)}>
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}
