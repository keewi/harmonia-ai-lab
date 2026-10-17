import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { createRun, runFile } from "@/lib/runs";
import { YOUTUBE } from "@/lib/format";

/** Upload page → a new run. Scores arrive as files; carried-over ones as "runId|path" references. */
export async function POST(request: Request) {
  const form = await request.formData();
  const date = String(form.get("date") ?? "");
  const video_url = String(form.get("video_url") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("Choose the rehearsal date.");
  if (!YOUTUBE.test(video_url)) return bad("That doesn't look like a YouTube link.");

  const files: { name: string; data: Buffer }[] = [];
  for (const ref of form.getAll("carry")) {
    const [id, rel, name] = String(ref).split("|");
    try {
      files.push({ name: name || rel.split("/").pop() || "score.pdf", data: await readFile(runFile(id, rel)) });
    } catch {
      return bad("One of the carried-over scores is missing. Remove it and attach the PDF instead.");
    }
  }
  for (const entry of form.getAll("scores")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const data = Buffer.from(await entry.arrayBuffer());
    if (data.subarray(0, 5).toString() !== "%PDF-") return bad(`${entry.name} isn't a PDF.`);
    files.push({ name: entry.name, data });
  }
  if (files.length === 0) return bad("Add at least one sheet music PDF.");

  const id = await createRun({ date, video_url, description }, files);
  return NextResponse.json({ id });
}

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
