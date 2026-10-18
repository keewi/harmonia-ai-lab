import { pdfName, pdfResponse } from "@/lib/blob-store";
import { getShared, getSharedPdf } from "@/lib/share";

/** A shared rehearsal's annotated PDF, read from the private store. ?download=1 saves it. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; n: string }> }) {
  const { token, n } = await params;
  const index = Number(n);
  const [shared, stream] = await Promise.all([getShared(token), getSharedPdf(token, index)]);
  if (!shared || !stream) return new Response("Not found", { status: 404 });
  const title = shared.result.scores[index]?.title ?? "Score";
  return pdfResponse(stream, pdfName(title, shared.meta.date), new URL(request.url).searchParams.has("download"));
}
