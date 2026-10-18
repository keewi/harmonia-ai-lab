import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Page } from "@/components/header";
import { btn, card, eyebrow } from "@/components/ui";
import { listRuns } from "@/lib/runs";
import { getLibraryIndex, syncLibrary } from "@/lib/library";
import { isHosted } from "@/lib/mode";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Row = { id: string; href: string; date: string; line: string; badge?: { text: string; tone: "failed" | "progress" } };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Locally: every run on this Mac. Hosted: the library index this Mac publishes.
 * Both oldest first by rehearsal date (not upload date), so the list reads in
 * the order the season happened.
 */
async function rows(): Promise<Row[]> {
  if (isHosted()) {
    return (await getLibraryIndex())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        id: e.id,
        href: `/runs/${e.id}`,
        date: e.date,
        line: `${plural(e.songs, "song")} · ${plural(e.notes, "note")}${e.description ? ` · ${e.description}` : ""}`,
      }));
  }
  // Catch the library up with anything finished since it last synced. It runs in
  // the background so this page never waits on an upload.
  void syncLibrary();
  const runs = (await listRuns()).sort(
    (a, b) => a.meta.date.localeCompare(b.meta.date) || a.meta.created_at.localeCompare(b.meta.created_at),
  );
  return runs.map(({ meta, status, result }) => {
    const songs = result?.songs.length ?? 0;
    const notes = result?.songs.reduce((n, s) => n + s.notes, 0) ?? 0;
    return {
      id: meta.id,
      href: status.status === "done" ? `/runs/${meta.id}` : `/runs/${meta.id}/processing`,
      date: meta.date,
      line:
        status.status === "done"
          ? `${plural(songs, "song")} · ${plural(notes, "note")}${meta.description ? ` · ${meta.description}` : ""}`
          : status.status === "error"
            ? "Didn't finish"
            : "Processing…",
      badge:
        status.status === "error"
          ? { text: "Failed", tone: "failed" }
          : status.status !== "done"
            ? { text: `${status.progress}%`, tone: "progress" }
            : undefined,
    };
  });
}

export default async function HistoryPage() {
  const hosted = isHosted();
  const list = await rows();
  return (
    <Page>
      <p className={eyebrow}>{hosted ? "Library" : "History"}</p>
      <h1 className="mb-8 mt-1 font-display text-3xl uppercase leading-tight text-ink md:text-4xl">Past rehearsals</h1>
      {list.length === 0 ? (
        <div className={`${card} p-6`}>
          <p className="text-grey-700">{hosted ? "No rehearsals here yet." : "Nothing processed yet."}</p>
          {hosted ? null : (
            <Link href="/" className={`${btn.primary} mt-4`}>
              Upload a rehearsal
            </Link>
          )}
        </div>
      ) : (
        <ul className={`${card} divide-y divide-border-subtle`}>
          {list.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className="flex items-center gap-4 px-5 py-4 text-ink no-underline hover:bg-grey-50 hover:text-ink">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{fmtDate(r.date)}</p>
                  <p className="truncate text-sm text-grey-500">{r.line}</p>
                </div>
                {r.badge ? (
                  <span
                    className={
                      r.badge.tone === "failed"
                        ? "rounded-pill bg-blush px-2.5 py-1 text-[13px] font-semibold text-red-700"
                        : "rounded-pill bg-amber-100 px-2.5 py-1 text-[13px] font-semibold text-grey-900"
                    }
                  >
                    {r.badge.text}
                  </span>
                ) : null}
                <ChevronRight size={18} className="shrink-0 text-grey-500" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
