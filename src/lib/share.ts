import "server-only";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { deletePrefix, readJson, readPdf, uploadSnapshot, type Snapshot } from "@/lib/blob-store";
import { runDir } from "@/lib/runs";

/**
 * Sharing copies one finished rehearsal into the private blob store under
 * shares/<token>/, and the hosted copy of this app serves it at /s/<token>
 * with no password. The token is the only key: unguessable, one rehearsal
 * each, and deleting the blobs (Stop sharing) kills the link.
 */
export const TOKEN = /^[A-Za-z0-9_-]{24}$/;

/** Shares made before the library existed say shared_at; newer ones published_at. */
export type Shared = Pick<Snapshot, "meta" | "result">;

export function shareOrigin() {
  return (process.env.LAB_SHARE_ORIGIN || "https://golden-gate-harmonia.vercel.app").replace(/\/$/, "");
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
  const token = randomBytes(18).toString("base64url");
  const snapshot = await uploadSnapshot(id, `shares/${token}/`, "share.json");
  const record = { token, shared_at: snapshot.published_at };
  await writeFile(path.join(runDir(id), "share.json"), JSON.stringify(record, null, 2));
  return record;
}

export async function unshareRun(id: string) {
  const existing = await readShare(id);
  if (!existing) return;
  await deletePrefix(`shares/${existing.token}/`);
  await rm(path.join(runDir(id), "share.json"), { force: true });
}

export async function getShared(token: string): Promise<Shared | null> {
  return TOKEN.test(token) ? readJson<Shared>(`shares/${token}/share.json`) : null;
}

export async function getSharedPdf(token: string, index: number) {
  if (!TOKEN.test(token) || !Number.isInteger(index) || index < 0) return null;
  return readPdf(`shares/${token}/${index}.pdf`);
}
