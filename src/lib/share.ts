import "server-only";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";
import { getRun, runDir, runFile, type RunMeta, type RunResult } from "@/lib/runs";

/**
 * Sharing copies one finished rehearsal into a PRIVATE Vercel Blob store under
 * shares/<token>/, and the hosted copy of this app serves it at /s/<token>.
 * The token is the only key: unguessable, one rehearsal each, and deleting the
 * blobs (Stop sharing) kills the link. Blobs are private, so the scores, which
 * are licensed music, are never at a public URL; only /s/<token> can read them.
 */
export const TOKEN = /^[A-Za-z0-9_-]{24}$/;

export type Shared = {
  meta: Pick<RunMeta, "date" | "video_url" | "description">;
  result: RunResult;
  shared_at: string;
};

export function shareOrigin() {
  return (process.env.LAB_SHARE_ORIGIN || "https://harmonia-ai-lab.vercel.app").replace(/\/$/, "");
}

export function shareUrl(token: string) {
  return `${shareOrigin()}/s/${token}`;
}

/** Local record of a run's share, so the lab knows the link and can revoke it. */
export async function readShare(id: string): Promise<{ token: string; shared_at: string } | null> {
  try {
    return JSON.parse(await readFile(path.join(runDir(id), "share.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function shareRun(id: string) {
  const existing = await readShare(id);
  if (existing) return existing;
  const run = await getRun(id);
  if (!run?.result) throw new Error("Only a finished rehearsal can be shared.");

  const token = randomBytes(18).toString("base64url");
  const prefix = `shares/${token}/`;
  const opts = { access: "private" as const, addRandomSuffix: false, allowOverwrite: true };

  // Scores go up as 0.pdf, 1.pdf… so nothing about local paths leaves this Mac.
  const scores = await Promise.all(
    run.result.scores.map(async (s, i) => {
      await put(`${prefix}${i}.pdf`, await readFile(runFile(id, s.file)), { ...opts, contentType: "application/pdf" });
      return { ...s, file: `${i}.pdf` };
    }),
  );
  const shared: Shared = {
    meta: { date: run.meta.date, video_url: run.meta.video_url, description: run.meta.description },
    result: { ...run.result, scores, songs: run.result.songs.map((s) => ({ ...s, annotated: null })) },
    shared_at: new Date().toISOString(),
  };
  // share.json goes last: the page treats its presence as "this share is complete".
  await put(`${prefix}share.json`, JSON.stringify(shared), { ...opts, contentType: "application/json" });

  const record = { token, shared_at: shared.shared_at };
  await writeFile(path.join(runDir(id), "share.json"), JSON.stringify(record, null, 2));
  return record;
}

export async function unshareRun(id: string) {
  const existing = await readShare(id);
  if (!existing) return;
  const prefix = `shares/${existing.token}/`;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    if (page.blobs.length) await del(page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  await rm(path.join(runDir(id), "share.json"), { force: true });
}

export async function getShared(token: string): Promise<Shared | null> {
  if (!TOKEN.test(token)) return null;
  try {
    const res = await get(`shares/${token}/share.json`, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return JSON.parse(await new Response(res.stream).text()) as Shared;
  } catch {
    return null;
  }
}

export async function getSharedPdf(token: string, index: number) {
  if (!TOKEN.test(token) || !Number.isInteger(index) || index < 0) return null;
  try {
    const res = await get(`shares/${token}/${index}.pdf`, { access: "private" });
    return res && res.statusCode === 200 ? res.stream : null;
  } catch {
    return null;
  }
}
