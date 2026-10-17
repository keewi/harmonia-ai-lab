"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileMusic, History, Upload, X } from "lucide-react";
import { btn, card, field, label } from "@/components/ui";
import { YOUTUBE } from "@/lib/format";

export type Carried = { ref: string; title: string; detail: string };

type Score = { id: string; title: string; detail: string; file?: File; ref?: string };

export function UploadForm({ today, carried }: { today: string; carried: Carried[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [scores, setScores] = useState<Score[]>(() => carried.map((c) => ({ id: c.ref, title: c.title, detail: c.detail, ref: c.ref })));
  const [video, setVideo] = useState("");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const videoError = touched && video && !YOUTUBE.test(video.trim()) ? "That doesn't look like a YouTube link." : null;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const pdfs = Array.from(list).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length < list.length) setError("Only PDFs can be added as sheet music.");
    else setError(null);
    setScores((prev) => [
      ...prev,
      ...pdfs.map((f) => ({
        id: `${f.name}-${f.size}-${f.lastModified}`,
        title: f.name.replace(/\.pdf$/i, ""),
        detail: `${(f.size / 1e6).toFixed(1)} MB`,
        file: f,
      })).filter((s) => !prev.some((p) => p.id === s.id)),
    ]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!scores.length) return setError("Add at least one sheet music PDF.");
    if (!YOUTUBE.test(video.trim())) return setError("Add the YouTube link for the rehearsal.");
    setError(null);
    setBusy(true);
    const body = new FormData();
    body.set("date", date);
    body.set("video_url", video.trim());
    body.set("description", description);
    for (const s of scores) {
      if (s.ref) body.append("carry", s.ref);
      if (s.file) body.append("scores", s.file);
    }
    try {
      const res = await fetch("/api/runs", { method: "POST", body });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error || "Upload failed. Try again.");
      router.push(`/runs/${data.id}/processing`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-7">
      <section>
        <span className={label}>Sheet music</span>
        <p className="-mt-1 mb-3 text-sm text-grey-500">One PDF per song. Add as many songs as were rehearsed.</p>
        {scores.length > 0 ? (
          <ul className={`${card} mb-3 divide-y divide-border-subtle`}>
            {scores.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                {s.ref ? <History size={18} className="shrink-0 text-brand" aria-hidden /> : <FileMusic size={18} className="shrink-0 text-grey-500" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{s.title}</p>
                  <p className="text-[13px] text-grey-500">{s.ref ? `Carried over · ${s.detail}` : s.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setScores((prev) => prev.filter((p) => p.id !== s.id))}
                  className="rounded-control p-1.5 text-grey-500 hover:bg-grey-100 hover:text-ink"
                  aria-label={`Remove ${s.title}`}
                >
                  <X size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => input.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-brand bg-blush" : "border-grey-300 bg-grey-50 hover:border-grey-500"
          }`}
        >
          <Upload size={22} className="mb-2 text-grey-700" aria-hidden />
          <p className="text-[15px] font-medium text-ink">Drop PDFs here or click to choose</p>
          <p className="text-sm text-grey-500">An annotated PDF from this lab keeps its earlier notes</p>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
        </div>
      </section>

      <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
        <div>
          <label htmlFor="video" className={label}>
            YouTube link
          </label>
          <input
            id="video"
            type="url"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={video}
            onChange={(e) => setVideo(e.target.value)}
            onBlur={() => setTouched(true)}
            className={field}
            aria-invalid={videoError ? true : undefined}
          />
          {videoError ? <p className="mt-1.5 text-sm text-brand">{videoError}</p> : null}
        </div>
        <div>
          <label htmlFor="date" className={label}>
            Rehearsal date
          </label>
          <input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required className={field} />
        </div>
      </div>

      <div>
        <label htmlFor="description" className={label}>
          Description <span className="font-normal text-grey-500">(optional)</span>
        </label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Anything worth knowing, like a guest coach or which songs were the focus"
          className={`${field} resize-y`}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-control bg-blush px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className={btn.primary}>
        {busy ? "Uploading…" : "Process rehearsal"} <ArrowRight size={16} aria-hidden />
      </button>
    </form>
  );
}
