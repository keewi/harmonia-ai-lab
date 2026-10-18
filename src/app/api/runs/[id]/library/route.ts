import { NextResponse } from "next/server";
import { getRun } from "@/lib/runs";
import { publishToLibrary, removeFromLibrary } from "@/lib/library";

/** Put a rehearsal (back) in the hosted library. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run?.result) return NextResponse.json({ error: "Only a finished rehearsal can go in the library." }, { status: 400 });
  try {
    await publishToLibrary(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't publish that." }, { status: 500 });
  }
}

/** Take a rehearsal out of the hosted library; the automatic sync won't put it back. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getRun(id))) return NextResponse.json({ error: "No such rehearsal" }, { status: 404 });
  try {
    await removeFromLibrary(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't remove that." }, { status: 500 });
  }
}
