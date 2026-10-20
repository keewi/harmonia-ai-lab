import type { ReactNode } from "react";
import { ChevronDown, ExternalLink, PlayCircle } from "lucide-react";
import { card, eyebrow } from "@/components/ui";
import { ScoreList } from "@/components/score-list";
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
 * render this, so a shared link shows exactly what we see, minus `actions`
 * and `rehearsalAction` (the lab's Edit button).
 */
export function ResultsView({
  meta,
  result,
  fileUrl,
  actions,
  rehearsalAction,
}: {
  meta: Pick<RunMeta, "date" | "video_url" | "description">;
  result: RunResult;
  /** Where the i-th annotated score is served from. */
  fileUrl: (rel: string, index: number) => string;
  actions?: ReactNode;
  /** Top-right of the Rehearsal card. Only the lab passes one. */
  rehearsalAction?: ReactNode;
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
        <section className="min-w-0" aria-labelledby="songs-heading">
          <div className="mb-4">
            <h2 id="songs-heading" className="font-display text-xl uppercase text-ink md:text-2xl">
              Songs rehearsed
            </h2>
            <p className="mt-1 text-sm text-grey-700">
              {result.songs.length
                ? `${totalNotes} director note${totalNotes === 1 ? "" : "s"} across ${result.songs.length} song${result.songs.length === 1 ? "" : "s"}. Open a song to see its notes and jump to that moment in the video.`
                : "We couldn't tell which songs were rehearsed."}
            </p>
          </div>
          <ul className="space-y-3">
            {result.songs.map((s) => (
              <li key={s.title}>
                <details className={`group ${card} overflow-hidden`} data-song={s.title}>
                  <summary className="flex cursor-pointer list-none items-start gap-4 p-5 transition-colors hover:bg-grey-50 group-open:bg-grey-50 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold leading-snug text-ink">{s.title}</p>
                      {s.worked_on ? <p className="mt-1 text-[15px] text-grey-700">{s.worked_on}</p> : null}
                      <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                        <span className="group-open:hidden">Show notes &amp; timestamps</span>
                        <span className="hidden group-open:inline">Hide notes</span>
                        <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
                      </p>
                    </div>
                    <NoteCount song={s} />
                  </summary>
                  <div className="border-t border-border-subtle">
                    {s.start_s != null || !s.has_score ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-4 text-sm">
                        {s.start_s != null ? (
                          <a href={videoAt(meta.video_url, s.start_s)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium">
                            <PlayCircle size={16} aria-hidden /> Watch from {clock(s.start_s)}
                          </a>
                        ) : null}
                        {!s.has_score ? <span className="text-grey-500">No sheet music uploaded, so these notes are listed here only</span> : null}
                      </div>
                    ) : null}
                    <Notes markings={s.markings} video={meta.video_url} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>

        <aside className="min-w-0 space-y-6">
          <section className={`${card} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className={eyebrow}>Rehearsal</h2>
              {rehearsalAction}
            </div>
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
          <ScoreList scores={result.scores.map((sc, i) => ({ title: sc.title, url: fileUrl(sc.file, i), dates: sc.dates, heard: sc.heard }))} />
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
    <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
      <span className="rounded-pill bg-blush px-3 py-1 text-sm font-semibold text-red-700">
        {s.notes} note{s.notes === 1 ? "" : "s"}
      </span>
      {s.notes > 0 && s.has_score ? (
        <span className="hidden text-[12px] leading-snug text-grey-500 sm:inline">
          {inMusic} in the music
          <br />
          {atBack} in the summary
        </span>
      ) : null}
    </div>
  );
}

function Notes({ markings, video }: { markings: Marking[]; video: string }) {
  if (!markings.length) return <p className="px-5 py-4 text-sm text-grey-500">No director notes for this song.</p>;
  const sorted = [...markings].sort((a, b) => (a.measure ?? 9999) - (b.measure ?? 9999));
  return (
    <ol className="divide-y divide-border-subtle px-5">
      {sorted.map((m, i) => (
        <li key={i} className="flex gap-4 py-3.5 text-[15px]">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-grey-500">
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
            </div>
            <p className="text-grey-900">{m.text}</p>
          </div>
          {m.at_s != null ? (
            <a
              href={videoAt(video, m.at_s)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-pill border border-grey-200 px-2.5 text-[13px] font-medium text-ink no-underline hover:border-ink hover:text-ink"
              aria-label={`Watch this at ${clock(m.at_s)}`}
            >
              <PlayCircle size={15} className="text-brand" aria-hidden /> {clock(m.at_s)}
            </a>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
