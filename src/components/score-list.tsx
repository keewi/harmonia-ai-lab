"use client";

import { useEffect, useState } from "react";
import { Download, Eye, FileMusic, X } from "lucide-react";
import { PdfViewer } from "@/components/pdf-viewer";
import { btn, card, eyebrow } from "@/components/ui";

export type ScoreItem = { title: string; url: string; dates: string[]; heard: boolean };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The annotated scores as a compact list: View opens one in a pop-up viewer,
 * Download saves it. The songs are the page; the PDFs are a reference.
 */
export function ScoreList({ scores }: { scores: ScoreItem[] }) {
  const [open, setOpen] = useState<ScoreItem | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!scores.length) return null;
  return (
    <section className={`${card} p-5`} aria-label="Annotated sheet music">
      <h2 className={eyebrow}>Annotated sheet music</h2>
      <ul className="mt-3 divide-y divide-border-subtle">
        {scores.map((s) => (
          <li key={s.url} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <FileMusic size={18} className="shrink-0 text-grey-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-ink">{s.title}</p>
              <p className="text-[13px] text-grey-500">
                {s.heard ? `Notes from ${plural(s.dates.length, "rehearsal")}` : "Not rehearsed this time"}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(s)} className={`${btn.ghost} h-8 px-2`} aria-label={`View ${s.title}`}>
              <Eye size={16} aria-hidden /> <span className="hidden sm:inline">View</span>
            </button>
            <a href={`${s.url}?download=1`} download data-score={s.title} className={`${btn.ghost} h-8 px-2`} aria-label={`Download ${s.title}`}>
              <Download size={16} aria-hidden />
            </a>
          </li>
        ))}
      </ul>

      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-grey-900/95" role="dialog" aria-modal="true" aria-label={`${open.title}, annotated`}>
          <div className="flex items-center gap-3 px-4 py-3 text-white md:px-6">
            <p className="min-w-0 flex-1 truncate font-semibold">{open.title}</p>
            <a
              href={`${open.url}?download=1`}
              download
              data-score={open.title}
              className="inline-flex h-9 items-center gap-1.5 rounded-control px-3 text-sm font-medium text-white no-underline hover:bg-white/10 hover:text-white"
            >
              <Download size={16} aria-hidden /> Download
            </a>
            <button type="button" onClick={() => setOpen(null)} className="rounded-control p-2 text-white hover:bg-white/10" aria-label="Close">
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 md:px-6">
            <div className="mx-auto max-w-[900px]">
              <PdfViewer url={open.url} fileName={`${open.title} annotated`} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
