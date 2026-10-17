import { notFound, redirect } from "next/navigation";
import { Page } from "@/components/header";
import { eyebrow } from "@/components/ui";
import { getRun } from "@/lib/runs";
import { fmtDate } from "@/lib/format";
import { Progress } from "./progress";

export default async function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  if (run.status.status === "done") redirect(`/runs/${id}`);

  return (
    <Page>
      <p className={eyebrow}>{fmtDate(run.meta.date)}</p>
      <h1 className="mb-8 mt-1 font-display text-3xl uppercase leading-tight text-ink md:text-4xl">Processing</h1>
      <Progress id={id} initial={run.status} scores={run.meta.scores.length} />
    </Page>
  );
}
