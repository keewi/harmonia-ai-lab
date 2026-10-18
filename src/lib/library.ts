import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deletePrefix, putJson, readJson, readPdf, uploadSnapshot, type Snapshot } from "@/lib/blob-store";
import { listRuns, runDir, type Run } from "@/lib/runs";

/**
 * The hosted library: every finished rehearsal, mirrored from this Mac to the
 * private blob store under library/<run id>/, plus library/index.json for the
 * hosted Past rehearsals page. The hosted site serves it behind the password.
 *
 * This Mac is the source of truth. Each run folder records its library state in
 * library.json: { published_at } once it is up, or { removed: true } when you
 * took it down, so the automatic sync never puts it back. The index is always
 * rebuilt from those records, never edited in place.
 */
const RUN_ID = /^[a-z0-9-]{6,40}$/;

export type LibraryEntry = {
  id: string;
  date: string;
  description: string;
  songs: number;
  notes: number;
};

type Record = { published_at?: string; removed?: boolean };

async function readRecord(id: string): Promise<Record | null> {
  try {
    return JSON.parse(await readFile(path.join(runDir(id), "library.json"), "utf8"));
  } catch {
    return null;
  }
}

async function writeRecord(id: string, record: Record) {
  await writeFile(path.join(runDir(id), "library.json"), JSON.stringify(record, null, 2));
}

export async function libraryState(id: string): Promise<"published" | "removed" | "pending"> {
  const r = await readRecord(id);
  return r?.published_at ? "published" : r?.removed ? "removed" : "pending";
}

function entry(run: Run): LibraryEntry {
  const songs = run.result?.songs ?? [];
  return {
    id: run.meta.id,
    date: run.meta.date,
    description: run.meta.description,
    songs: songs.length,
    notes: songs.reduce((n, s) => n + s.notes, 0),
  };
}

async function rebuildIndex() {
  const runs = await listRuns();
  const published: LibraryEntry[] = [];
  for (const run of runs) if (run.result && (await libraryState(run.meta.id)) === "published") published.push(entry(run));
  await putJson("library/index.json", published);
}

export async function publishToLibrary(id: string) {
  await uploadSnapshot(id, `library/${id}/`, "run.json");
  await writeRecord(id, { published_at: new Date().toISOString() });
  await rebuildIndex();
}

export async function removeFromLibrary(id: string) {
  await writeRecord(id, { removed: true });
  await rebuildIndex();
  await deletePrefix(`library/${id}/`);
}

// One sync at a time per server: the processing page polls every two seconds,
// and two overlapping syncs would upload the same rehearsal twice.
let syncing: Promise<void> | null = null;

/** Publish every finished rehearsal that isn't up yet and wasn't removed. Safe to call often. */
export function syncLibrary() {
  if (!process.env.BLOB_READ_WRITE_TOKEN || process.env.LAB_HOSTED === "1") return Promise.resolve();
  syncing ??= (async () => {
    try {
      for (const run of await listRuns()) {
        if (run.status.status === "done" && run.result && (await libraryState(run.meta.id)) === "pending") {
          await publishToLibrary(run.meta.id);
        }
      }
    } catch (err) {
      console.error("Library sync failed:", err);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// ---- hosted side: read-only -------------------------------------------------

export async function getLibraryIndex(): Promise<LibraryEntry[]> {
  return (await readJson<LibraryEntry[]>("library/index.json")) ?? [];
}

export async function getLibraryRun(id: string): Promise<Snapshot | null> {
  return RUN_ID.test(id) ? readJson<Snapshot>(`library/${id}/run.json`) : null;
}

export async function getLibraryPdf(id: string, index: number) {
  if (!RUN_ID.test(id) || !Number.isInteger(index) || index < 0) return null;
  return readPdf(`library/${id}/${index}.pdf`);
}

/** Re-upload a library rehearsal after an edit, and rebuild the index (its date may have moved). */
export async function refreshLibrary(id: string) {
  if ((await libraryState(id)) === "published") await publishToLibrary(id);
}
