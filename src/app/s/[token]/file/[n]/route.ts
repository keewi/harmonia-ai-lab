import { getShared, getSharedPdf } from "@/lib/share";

/** A shared rehearsal's annotated PDF, read from the private store. ?download=1 saves it. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; n: string }> }) {
  const { token, n } = await params;
  const index = Number(n);
  const [shared, stream] = await Promise.all([getShared(token), getSharedPdf(token, index)]);
  if (!shared || !stream) return new Response("Not found", { status: 404 });
  const title = shared.result.scores[index]?.title ?? "Score";
  const name = `${title.replace(/[\\/:*?"<>|]+/g, "-")} annotated ${shared.meta.date}.pdf`;
  const download = new URL(request.url).searchParams.has("download");
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/[^\x20-\x7e]|"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
