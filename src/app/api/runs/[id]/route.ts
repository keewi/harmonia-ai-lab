import { rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { editRun, getRun, runDir, startPipeline } from "@/lib/runs";
import { refreshLibrary, syncLibrary } from "@/lib/library";
import { isHosted } from "@/lib/mode";
import { refreshShare } from "@/lib/share";

/** What the processing page polls. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const run = await getRun((await params).id);
  if (!run) return NextResponse.json({ error: "No such run" }, { status: 404 });
  if (run.status.status === "done") void syncLibrary(); // straight into the hosted library
  return NextResponse.json(run.status, { headers: { "cache-control": "no-store" } });
}

/** Retry a failed run. The transcript is cached in work/, so a retry skips straight past YouTube. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "No such run" }, { status: 404 });
  if (run.status.status !== "error") return NextResponse.json({ error: "That run isn't stuck" }, { status: 409 });
  await rm(path.join(runDir(id), "status.json"), { force: true });
  startPipeline(id);
  return NextResponse.json({ ok: true });
}

/**
 * Edit a finished rehearsal's date or description, from the lab only (the
 * proxy 404s this on Vercel, and so does the check below). Hosted copies, the
 * library entry and any share link, are re-uploaded so they match.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isHosted()) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  let body: { date?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const date = typeof body.date === "string" ? body.date : undefined;
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : undefined;
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Choose a valid date." }, { status: 400 });
  try {
    await editRun(id, { date, description });
    await Promise.all([refreshLibrary(id), refreshShare(id)]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save that." }, { status: 500 });
  }
}
