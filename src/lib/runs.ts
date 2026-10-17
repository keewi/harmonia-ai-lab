import "server-only";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A run is a folder, not a row: data/runs/<id>/ holds what the upload page
 * wrote (run.json, inputs/), what the pipeline reports while it works
 * (status.json, pipeline.log) and what it made (result.json, out/).
 */
export const DATA_DIR = path.join(process.cwd(), "data", "runs");

export type RunMeta = {
  id: string;
  created_at: string;
  date: string; // YYYY-MM-DD, the rehearsal's calendar date
  video_url: string;
  description: string;
  scores: { key: string; name: string; file: string }[];
};

export type RunStatus = {
  status: "queued" | "running" | "done" | "error";
  stage: string;
  progress: number;
  message: string;
  error?: string;
  updated_at?: number;
};

export type Marking = {
  measure: number | null;
  measure_end: number | null;
  tier: "act" | "note" | "standing";
  status: "settled" | "open";
  kind: string;
  parts: string[] | null;
  tag: string | null;
  text: string;
  at_s: number | null;
};

export type RunResult = {
  video_title: string;
  transcript_source: string;
  minutes: number;
  summary: string;
  songs: {
    title: string;
    worked_on?: string;
    notes: number;
    start_s: number | null;
    has_score: boolean;
    annotated: string | null;
    markings: Marking[];
  }[];
  scores: { key: string; title: string; name: string; file: string; dates: string[]; heard: boolean }[];
  model: string;
  seconds: number;
};

export type Run = { meta: RunMeta; status: RunStatus; result: RunResult | null };

const ID = /^[a-z0-9-]{6,40}$/;

export function runDir(id: string) {
  if (!ID.test(id)) throw new Error("Bad run id");
  return path.join(DATA_DIR, id);
}

/** A file inside a run, refusing anything that climbs out of it. */
export function runFile(id: string, rel: string) {
  const dir = runDir(id);
  const full = path.resolve(dir, rel);
  if (!full.startsWith(dir + path.sep)) throw new Error("Bad path");
  return full;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function getRun(id: string): Promise<Run | null> {
  if (!ID.test(id)) return null;
  const dir = runDir(id);
  const meta = await readJson<RunMeta>(path.join(dir, "run.json"));
  if (!meta) return null;
  const status = (await readJson<RunStatus>(path.join(dir, "status.json"))) ?? {
    status: "queued",
    stage: "queued",
    progress: 0,
    message: "Waiting to start",
  };
  // A pipeline that died without reporting (killed, laptop slept and was restarted) would
  // otherwise spin forever. Twenty quiet minutes is far longer than any single stage.
  if (status.status === "running" && status.updated_at && Date.now() / 1000 - status.updated_at > 20 * 60) {
    status.status = "error";
    status.error = "The pipeline stopped reporting. It may have been interrupted. Try uploading again.";
  }
  const result = status.status === "done" ? await readJson<RunResult>(path.join(dir, "result.json")) : null;
  return { meta, status, result };
}

export async function listRuns(): Promise<Run[]> {
  if (!existsSync(DATA_DIR)) return [];
  const ids = (await readdir(DATA_DIR)).filter((d) => ID.test(d));
  const runs = (await Promise.all(ids.map(getRun))).filter((r): r is Run => r !== null);
  return runs.sort((a, b) => b.meta.date.localeCompare(a.meta.date) || b.meta.created_at.localeCompare(a.meta.created_at));
}

export async function createRun(input: Omit<RunMeta, "id" | "created_at" | "scores">, files: { name: string; data: Buffer }[]) {
  const id = `${input.date}-${randomBytes(3).toString("hex")}`;
  const dir = runDir(id);
  await mkdir(path.join(dir, "inputs"), { recursive: true });
  const scores = await Promise.all(
    files.map(async (f, i) => {
      const key = `s${i + 1}`;
      const file = `inputs/${key}.pdf`;
      await writeFile(path.join(dir, file), f.data);
      return { key, name: f.name, file };
    }),
  );
  const meta: RunMeta = { id, created_at: new Date().toISOString(), scores, ...input };
  await writeFile(path.join(dir, "run.json"), JSON.stringify(meta, null, 2));
  startPipeline(id);
  return id;
}

function pythonBin() {
  if (process.env.LAB_PYTHON) return process.env.LAB_PYTHON;
  const local = path.join(process.cwd(), ".venv", "bin", "python");
  return existsSync(local) ? local : "python3";
}

/** Fire and forget: the pipeline reports through status.json, and outlives this request. */
export function startPipeline(id: string) {
  const dir = runDir(id);
  const log = openSync(path.join(dir, "pipeline.log"), "a");
  const child = spawn(pythonBin(), ["-W", "ignore", path.join(process.cwd(), "pipeline", "run.py"), dir], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
}
