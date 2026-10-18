"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { btn, field, label } from "@/components/ui";

/** Edit a rehearsal's date and description. Lab only; the hosted library never renders it. */
export function EditRehearsal({ id, date, description, today }: { id: string; date: string; description: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newDate, setNewDate] = useState(date);
  const [newDescription, setNewDescription] = useState(description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const dateChanged = newDate !== date;
  const changed = dateChanged || newDescription.trim() !== description;

  function start() {
    setNewDate(date);
    setNewDescription(description);
    setError(null);
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changed) return setOpen(false);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(dateChanged ? { date: newDate } : {}), description: newDescription }),
    });
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error || "Couldn't save that. Try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" onClick={start} className={`${btn.ghost} -my-1.5 -mr-2 h-8 px-2`}>
        <Pencil size={14} aria-hidden /> Edit
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => !busy && setOpen(false)}>
          <form
            onSubmit={save}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
            className="w-full max-w-[440px] rounded-card bg-white p-6 shadow-[var(--shadow-overlay)]"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="edit-title" className="font-display text-xl uppercase text-ink">
                Edit rehearsal
              </h2>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-control p-1.5 text-grey-500 hover:bg-grey-100 hover:text-ink" aria-label="Close">
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="space-y-5">
              <div>
                <label htmlFor="edit-date" className={label}>
                  Rehearsal date
                </label>
                <input ref={first} id="edit-date" type="date" value={newDate} max={today} required onChange={(e) => setNewDate(e.target.value)} className={field} />
                {dateChanged ? (
                  <p className="mt-1.5 text-sm text-grey-500">The annotated sheet music is re-drawn with the new date. This takes a few seconds.</p>
                ) : null}
              </div>
              <div>
                <label htmlFor="edit-description" className={label}>
                  Description <span className="font-normal text-grey-500">(optional)</span>
                </label>
                <textarea id="edit-description" rows={3} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} className={`${field} resize-y`} />
              </div>
              {error ? (
                <p role="alert" className="rounded-control bg-blush px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className={btn.secondary}>
                Cancel
              </button>
              <button type="submit" disabled={busy || !changed || !newDate} className={btn.primary}>
                {busy ? (dateChanged ? "Re-drawing…" : "Saving…") : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
