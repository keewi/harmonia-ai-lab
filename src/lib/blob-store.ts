import "server-only";
import { readFile } from "node:fs/promises";
import { del, get, list, put } from "@vercel/blob";
import { getRun, runFile, type RunMeta, type RunResult } from "@/lib/runs";

/**
 * The private Vercel Blob store behind everything the hosted site shows: share
 * links (shares/<token>/) and the library (library/<run id>/). Private access
 * means no blob has a public URL; the hosted app reads them server-side and
 * decides who may see what. The scores are licensed music, so this matters.
 */
export type Snapshot = {
  meta: Pick<RunMeta, "date" | "video_url" | "description">;
  result: RunResult;
  published_at: string;
};

const OPTS = { access: "private" as const, addRandomSuffix: false, allowOverwrite: true };

/**
 * Copy one finished rehearsal under `prefix`: its annotated PDFs as 0.pdf,
 * 1.pdf… (so nothing about local paths leaves this Mac) and then `jsonName`,
 * written last so its presence means the copy is complete.
 */
export async function uploadSnapshot(id: string, prefix: string, jsonName: string): Promise<Snapshot> {
  const run = await getRun(id);
  if (!run?.result) throw new Error("Only a finished rehearsal can be published.");
  const scores = await Promise.all(
    run.result.scores.map(async (s, i) => {
      await put(`${prefix}${i}.pdf`, await readFile(runFile(id, s.file)), { ...OPTS, contentType: "application/pdf" });
      return { ...s, file: `${i}.pdf` };
    }),
  );
  const snapshot: Snapshot = {
    meta: { date: run.meta.date, video_url: run.meta.video_url, description: run.meta.description },
    result: { ...run.result, scores, songs: run.result.songs.map((s) => ({ ...s, annotated: null })) },
    published_at: new Date().toISOString(),
  };
  await putJson(`${prefix}${jsonName}`, snapshot);
  return snapshot;
}

export async function putJson(pathname: string, value: unknown) {
  await put(pathname, JSON.stringify(value), { ...OPTS, contentType: "application/json" });
}

export async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const res = await get(pathname, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return JSON.parse(await new Response(res.stream).text()) as T;
  } catch {
    return null;
  }
}

export async function readPdf(pathname: string) {
  try {
    const res = await get(pathname, { access: "private" });
    return res && res.statusCode === 200 ? res.stream : null;
  } catch {
    return null;
  }
}

export async function deletePrefix(prefix: string) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    if (page.blobs.length) await del(page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

/** A PDF response for the hosted viewer and its download button. */
export function pdfResponse(stream: ReadableStream<Uint8Array>, name: string, download: boolean) {
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/[^\x20-\x7e]|"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}

export function pdfName(title: string, date: string) {
  return `${title.replace(/[\\/:*?"<>|]+/g, "-")} annotated ${date}.pdf`;
}
