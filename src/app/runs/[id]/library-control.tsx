"use client";

import { useState } from "react";
import { Library } from "lucide-react";
import { btn } from "@/components/ui";

/** "In the library" status with Remove / Add back, at the foot of a results page. */
export function LibraryControl({ id, initial }: { id: string; initial: boolean }) {
  const [published, setPublished] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (published && !window.confirm("Remove this rehearsal from the hosted library? Members will no longer see it.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${id}/library`, { method: published ? "DELETE" : "POST" });
    if (res.ok) setPublished(!published);
    else setError(((await res.json().catch(() => ({}))) as { error?: string }).error || "That didn't work. Try again.");
    setBusy(false);
  }

  return (
    <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-5 text-sm text-grey-700">
      <Library size={16} className="text-grey-500" aria-hidden />
      <span>{published ? "In the hosted library for members." : "Not in the hosted library."}</span>
      <button type="button" onClick={toggle} disabled={busy} className={btn.ghost}>
        {busy ? "Working…" : published ? "Remove from library" : "Add to library"}
      </button>
      {error ? (
        <span role="alert" className="text-brand">
          {error}
        </span>
      ) : null}
    </div>
  );
}
