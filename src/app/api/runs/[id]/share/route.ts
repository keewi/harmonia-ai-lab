import { NextResponse } from "next/server";
import { shareRun, shareUrl, unshareRun } from "@/lib/share";

/** Share this rehearsal: copy it to the hosted viewer and return its link. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { token } = await shareRun((await params).id);
    return NextResponse.json({ url: shareUrl(token) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't share that." }, { status: 500 });
  }
}

/** Stop sharing: delete the hosted copy, which kills the link. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await unshareRun((await params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't stop sharing." }, { status: 500 });
  }
}
