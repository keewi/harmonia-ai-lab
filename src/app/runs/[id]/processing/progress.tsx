"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { btn, card } from "@/components/ui";
import type { RunStatus } from "@/lib/runs";

/** Deliberately vague: they set the mood, the bar and the line under it say where we really are. */
const MUSINGS = [
  "Listening closely",
  "Reading the sheet music",
  "Finding where each song starts",
  "Taking notes like a section leader",
  "Counting measures",
  "Working out which part the director meant",
  "Penciling in breath marks",
  "Humming along",
  "Matching lyrics to bars",
  "Checking the key change",
  "Sharpening the pencil",
  "Thinking about vowels",
  "Lining up the tags",
  "Tuning up",
];

const STAGES = [
  { key: "scores", label: "Sheet music" },
  { key: "transcript", label: "Recording" },
  { key: "overview", label: "Songs" },
  { key: "extraction", label: "Director notes" },
  { key: "annotation", label: "Annotating" },
];

export function Progress({ id, initial, scores }: { id: string; initial: RunStatus; scores: number }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [musing, setMusing] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const failed = status.status === "error";

  useEffect(() => {
    if (failed) return;
    const t = setInterval(() => setMusing((m) => (m + 1) % MUSINGS.length), 5000);
    return () => clearInterval(t);
  }, [failed]);

  useEffect(() => {
    if (failed) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as RunStatus;
          if (stop) return;
          setStatus(next);
          if (next.status === "done") router.replace(`/runs/${id}`);
        }
      } catch {
        /* the dev server restarting is not a failure; try again next tick */
      }
    };
    const t = setInterval(tick, 2000);
    void tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, failed, router]);

  async function retry() {
    setRetrying(true);
    const res = await fetch(`/api/runs/${id}`, { method: "POST" });
    if (res.ok) setStatus({ status: "queued", stage: "queued", progress: 0, message: "Starting again" });
    setRetrying(false);
  }

  if (failed) {
    return (
      <div className={`${card} p-6`}>
        <h2 className="text-lg font-semibold text-ink">That didn&apos;t work</h2>
        <p className="mt-2 whitespace-pre-line text-[15px] text-grey-700">{status.error || "Something went wrong."}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={retry} disabled={retrying} className={btn.primary}>
            <RotateCcw size={16} aria-hidden /> {retrying ? "Restarting…" : "Try again"}
          </button>
          <Link href="/" className={btn.secondary}>
            Start a new upload
          </Link>
        </div>
      </div>
    );
  }

  const pct = Math.max(2, Math.min(100, status.progress));
  const current = STAGES.findIndex((s) => s.key === status.stage);

  return (
    <div className={`${card} p-6 md:p-8`}>
      <p key={musing} className="min-h-[2.25rem] font-display text-xl uppercase text-ink motion-safe:animate-[lab-rise_320ms_ease-out] md:text-2xl" aria-live="polite">
        {MUSINGS[musing]}…
      </p>
      <div
        className="mt-5 h-3 w-full overflow-hidden rounded-pill bg-grey-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="Processing progress"
      >
        <div className="h-full rounded-pill bg-brand transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-sm text-grey-500">{status.message}</p>

      <ol className="mt-8 grid grid-cols-5 gap-2 text-center text-[12px] leading-tight">
        {STAGES.map((s, i) => {
          const done = current > i;
          const now = current === i;
          return (
            <li key={s.key}>
              <div className={`mb-2 h-1 rounded-pill ${done ? "bg-ink" : now ? "bg-brand" : "bg-grey-200"}`} />
              <span className={done || now ? "font-semibold text-ink" : "text-grey-500"}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 border-t border-border-subtle pt-4 text-sm text-grey-500">
        A full rehearsal takes a few minutes{scores > 1 ? `, a little longer with ${scores} scores` : ""}. You can leave this page.
        It keeps going, and the result shows up under Past rehearsals.
      </p>
    </div>
  );
}
