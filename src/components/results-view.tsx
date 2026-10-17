import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { card, eyebrow } from "@/components/ui";
import { ScorePanel } from "@/components/score-panel";
import type { Marking, RunMeta, RunResult } from "@/lib/runs";
import { clock, fmtDate, videoAt } from "@/lib/format";

const KIND: Record<string, string> = {
  breath: "Breath",
  "notes-rests": "Notes & rests",
  balance: "Balance",
  "tone-vowel": "Tone & vowels",
  pitch: "Pitch",
  character: "Character",
  "rubato-tempo": "Tempo",
  staging: "Staging",
  "open-question": "Open question",
};

const PART_DOT: Record<string, string> = { tenor: "bg-gold-400", lead: "bg-brand", baritone: "bg-blue-500", bass: "bg-ink" };

/**
 * One rehearsal's results. The lab's own page and the public share page both
 * render this, so a shared link shows exactly what we see, minus `actions`.
 */
export function ResultsView({
  meta,
  result,
  fileUrl,
  actions,
}: {
  meta: Pick<RunMeta, "date" | "video_url" | "description">;
  result: RunResult;
  /** Where the i-th annotated score is served from. */
  fileUrl: (rel: string, index: number) => string;
  actions?: ReactNode;
}) {
  const totalNotes = result.songs.reduce((n, s) => n + s.notes, 0);
  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={eyebrow}>Rehearsal notes</p>
          <h1 className="mt-1 font-display text-2xl uppercase leading-tight text-ink sm:text-3xl md:text-4xl">{fmtDate(meta.date)}</h1>
        </div>
        {actions ? <div className="flex flex-wrap items-start gap-3">{actions}</div> : null}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-6">
          <section className={card} aria-label="Songs rehearsed">
            <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
              <h2 className={eyebrow}>Songs rehearsed</h2>
              <span className="text-sm text-grey-500">
                {totalNotes} note{totalNotes === 1 ? "" : "s"} in all
              </span>
            </div>
            {result.songs.length === 0 ? (
              <p className="px-5 pb-5 text-[15px] text-grey-700">We couldn&apos;t tell which songs were rehearsed.</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {result.songs.map((s) => (
                  <li key={s.title}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3.5 hover:bg-grey-50 [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-ink">{s.title}</p>
                          {s.worked_on ? <p className="mt-0.5 text-sm text-grey-700">{s.worked_on}</p> : null}
                          <p className="mt-1 text-[13px] text-grey-500">
                            {[s.start_s != null ? `From ${clock(s.start_s)}` : null, s.has_score ? null : "No sheet music uploaded"].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <NoteCount song={s} />
                      </summary>
                      <Notes markings={s.markings} video={meta.video_url} />
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Annotated sheet music" className="min-w-0">
            <ScorePanel scores={result.scores.map((s, i) => ({ title: s.title, url: fileUrl(s.file, i), dates: s.dates, heard: s.heard }))} />
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section className={`${card} p-5`}>
            <h2 className={eyebrow}>Rehearsal</h2>
            <dl className="mt-3 space-y-3 text-[15px]">
              <div>
                <dt className="text-sm text-grey-500">Date</dt>
                <dd className="font-medium text-ink">{fmtDate(meta.date)}</dd>
              </div>
              {meta.description ? (
                <div>
                  <dt className="text-sm text-grey-500">Description</dt>
                  <dd className="whitespace-pre-line text-ink">{meta.description}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-sm text-grey-500">Video</dt>
                <dd>
                  <a href={meta.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 break-all">
                    {result.video_title || meta.video_url} <ExternalLink size={14} className="shrink-0" aria-hidden />
                  </a>
                  <span className="block text-sm text-grey-500">{result.minutes} minutes</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className={`${card} p-5`}>
            <h2 className={eyebrow}>Summary</h2>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-grey-900">{result.summary || "No summary came back."}</p>
          </section>
          <p className="text-[13px] text-grey-500">
            Written automatically from the video in {Math.max(1, Math.round(result.seconds / 60))} min, with no one checking it first, so
            check anything surprising against the video.
          </p>
        </aside>
      </div>
    </>
  );
}

/** The song's note count, and under it where those notes ended up in the PDF. */
function NoteCount({ song: s }: { song: RunResult["songs"][number] }) {
  const inMusic = s.placed ?? s.markings.filter((m) => m.measure != null).length;
  const atBack = s.notes - inMusic;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      <span className="rounded-pill bg-blush px-2.5 py-1 text-[13px] font-semibold text-red-700">
        {s.notes} note{s.notes === 1 ? "" : "s"}
      </span>
      {s.notes > 0 && s.has_score ? (
        <span className="text-[12px] leading-snug text-grey-700">
          {inMusic} in the music
          <br />
          {atBack} in the summary
        </span>
      ) : s.notes > 0 ? (
        <span className="text-[12px] leading-snug text-grey-700">Listed here only</span>
      ) : null}
    </div>
  );
}

function Notes({ markings, video }: { markings: Marking[]; video: string }) {
  if (!markings.length) return <p className="px-5 pb-4 text-sm text-grey-500">No director notes for this song.</p>;
  const sorted = [...markings].sort((a, b) => (a.measure ?? 9999) - (b.measure ?? 9999));
  return (
    <ol className="space-y-3 bg-grey-50 px-5 py-4">
      {sorted.map((m, i) => (
        <li key={i} className="text-sm">
          <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-grey-500">
            <span className={m.status === "open" ? "text-amber-500" : m.tier === "act" ? "text-blue-500" : "text-green-500"}>
              {m.measure != null ? `m.${m.measure}${m.measure_end ? `–${m.measure_end}` : ""}` : "Whole song"}
            </span>
            <span>{KIND[m.kind] ?? m.kind}</span>
            {m.status === "open" ? <span className="text-amber-500">Undecided</span> : null}
            {m.parts?.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 normal-case tracking-normal">
                <span className={`size-2 rounded-full ${PART_DOT[p] ?? "bg-grey-500"}`} aria-hidden />
                {p}
              </span>
            ))}
            {m.at_s != null ? (
              <a href={videoAt(video, m.at_s)} target="_blank" rel="noreferrer" className="normal-case tracking-normal">
                {clock(m.at_s)}
              </a>
            ) : null}
          </div>
          <p className="text-grey-900">{m.text}</p>
        </li>
      ))}
    </ol>
  );
}
