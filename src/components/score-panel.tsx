"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { PdfViewer } from "@/components/pdf-viewer";
import { btn } from "@/components/ui";

export type ScoreTab = { title: string; url: string; dates: string[]; heard: boolean };

/** The annotated scores, one tab each, with the download for whichever is showing. */
export function ScorePanel({ scores }: { scores: ScoreTab[] }) {
  const [i, setI] = useState(0);
  const s = scores[i];
  if (!s) return null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {scores.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Annotated scores">
            {scores.map((t, j) => (
              <button
                key={t.url}
                type="button"
                role="tab"
                aria-selected={j === i}
                onClick={() => setI(j)}
                className={
                  j === i
                    ? "rounded-pill bg-ink px-3.5 py-1.5 text-sm font-semibold text-white"
                    : "rounded-pill border border-grey-300 bg-white px-3.5 py-1.5 text-sm font-medium text-grey-700 hover:border-ink hover:text-ink"
                }
              >
                {t.title}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
        )}
        <a href={`${s.url}?download=1`} className={btn.secondary} download>
          <Download size={16} aria-hidden /> Download PDF
        </a>
      </div>
      {!s.heard ? (
        <p className="mb-3 rounded-control bg-amber-100 px-4 py-2.5 text-sm text-grey-900">
          We didn&apos;t hear this song in the rehearsal, so it has no new notes{s.dates.length ? " (earlier notes are kept)" : ""}.
        </p>
      ) : null}
      <PdfViewer url={s.url} fileName={`${s.title} annotated`} />
    </div>
  );
}
