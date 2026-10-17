import { rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getRun, runDir, startPipeline } from "@/lib/runs";

/** What the processing page polls. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const run = await getRun((await params).id);
  if (!run) return NextResponse.json({ error: "No such run" }, { status: 404 });
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
