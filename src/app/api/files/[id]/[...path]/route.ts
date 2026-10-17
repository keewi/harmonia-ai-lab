import { readFile } from "node:fs/promises";
import path from "node:path";
import { runFile } from "@/lib/runs";

/** An annotated PDF from a run: inline for the viewer, or ?download=1 to save it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path: parts } = await params;
  const rel = parts.map(decodeURIComponent).join("/");
  if (!rel.startsWith("out/") || !rel.endsWith(".pdf")) return new Response("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = await readFile(runFile(id, rel));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const download = new URL(request.url).searchParams.has("download");
  const name = path.basename(rel);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
}
