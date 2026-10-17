"use client";

import { useState } from "react";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { btn } from "@/components/ui";

/** Share / Copy link / Stop sharing for one rehearsal. */
export function ShareControl({ id, initial }: { id: string; initial: string | null }) {
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Best effort: some browsers refuse clipboard access, and the link is on screen to select anyway. */
  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      document.getElementById(`share-link-${id}`)?.focus();
    }
  }

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${id}/share`, { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't share that.");
      setUrl(data.url);
      await copy(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't share that.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!window.confirm("Stop sharing? Anyone with the link will no longer be able to open it.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${id}/share`, { method: "DELETE" });
    if (res.ok) setUrl(null);
    else setError("Couldn't stop sharing. Try again.");
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {url ? (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => copy(url)} className={btn.secondary} title={url}>
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? "Link copied" : "Copy share link"}
          </button>
          <button type="button" onClick={stop} disabled={busy} className={btn.ghost} aria-label="Stop sharing" title="Stop sharing">
            <Link2Off size={16} aria-hidden />
          </button>
        </div>
      ) : (
        <button type="button" onClick={share} disabled={busy} className={btn.secondary}>
          <Link2 size={16} aria-hidden /> {busy ? "Sharing…" : "Share"}
        </button>
      )}
      {url ? (
        <input
          id={`share-link-${id}`}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Share link"
          className="w-[300px] max-w-full rounded-control border border-grey-200 bg-grey-50 px-2.5 py-1.5 font-mono text-[12px] text-grey-700"
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-brand">
          {error}
        </p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {copied ? "Share link copied" : ""}
      </span>
    </div>
  );
}
