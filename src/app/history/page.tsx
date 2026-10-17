import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Page } from "@/components/header";
import { btn, card, eyebrow } from "@/components/ui";
import { listRuns } from "@/lib/runs";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const runs = await listRuns();
  return (
    <Page>
      <p className={eyebrow}>History</p>
      <h1 className="mb-8 mt-1 font-display text-3xl uppercase leading-tight text-ink md:text-4xl">Past rehearsals</h1>
      {runs.length === 0 ? (
        <div className={`${card} p-6`}>
          <p className="text-grey-700">Nothing processed yet.</p>
          <Link href="/" className={`${btn.primary} mt-4`}>
            Upload a rehearsal
          </Link>
        </div>
      ) : (
        <ul className={`${card} divide-y divide-border-subtle`}>
          {runs.map(({ meta, status, result }) => {
            const href = status.status === "done" ? `/runs/${meta.id}` : `/runs/${meta.id}/processing`;
            const songs = result?.songs.length ?? 0;
            const notes = result?.songs.reduce((n, s) => n + s.notes, 0) ?? 0;
            return (
              <li key={meta.id}>
                <Link href={href} className="flex items-center gap-4 px-5 py-4 text-ink no-underline hover:bg-grey-50 hover:text-ink">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{fmtDate(meta.date)}</p>
                    <p className="truncate text-sm text-grey-500">
                      {status.status === "done"
                        ? `${songs} song${songs === 1 ? "" : "s"} · ${notes} note${notes === 1 ? "" : "s"}${meta.description ? ` · ${meta.description}` : ""}`
                        : status.status === "error"
                          ? "Didn't finish"
                          : "Processing…"}
                    </p>
                  </div>
                  {status.status === "error" ? (
                    <span className="rounded-pill bg-blush px-2.5 py-1 text-[13px] font-semibold text-red-700">Failed</span>
                  ) : status.status !== "done" ? (
                    <span className="rounded-pill bg-amber-100 px-2.5 py-1 text-[13px] font-semibold text-grey-900">{status.progress}%</span>
                  ) : null}
                  <ChevronRight size={18} className="shrink-0 text-grey-500" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
