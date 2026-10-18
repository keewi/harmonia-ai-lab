import { pdfName, pdfResponse } from "@/lib/blob-store";
import { getLibraryPdf, getLibraryRun } from "@/lib/library";

/** A library rehearsal's annotated PDF. The proxy has already checked the password. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const index = Number(n);
  const [snap, stream] = await Promise.all([getLibraryRun(id), getLibraryPdf(id, index)]);
  if (!snap || !stream) return new Response("Not found", { status: 404 });
  const title = snap.result.scores[index]?.title ?? "Score";
  return pdfResponse(stream, pdfName(title, snap.meta.date), new URL(request.url).searchParams.has("download"));
}
