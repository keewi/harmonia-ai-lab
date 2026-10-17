import { Page } from "@/components/header";
import { eyebrow } from "@/components/ui";
import { getRun } from "@/lib/runs";
import { fmtDate, todayPacific } from "@/lib/format";
import { UploadForm, type Carried } from "./upload-form";

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const source = from ? await getRun(from) : null;
  // Carry the last run's annotated scores forward, so the next rehearsal's notes add to them.
  const carried: Carried[] =
    source?.result?.scores.map((s) => ({
      ref: `${source.meta.id}|${s.file}|${s.title} annotated.pdf`,
      title: s.title,
      detail: s.dates.length ? `Annotated from ${s.dates.length} rehearsal${s.dates.length === 1 ? "" : "s"}` : "Not annotated yet",
    })) ?? [];

  return (
    <Page>
      <p className={eyebrow}>{source ? `Continuing from ${fmtDate(source.meta.date, "short")}` : "New rehearsal"}</p>
      <h1 className="mb-2 mt-1 font-display text-3xl uppercase leading-tight text-ink md:text-4xl">Upload a rehearsal</h1>
      <p className="mb-8 max-w-[560px] text-grey-700">
        Add the sheet music and the rehearsal video. We&apos;ll find each song, pull out what the director asked for,
        and write it onto the score.
      </p>
      <UploadForm today={todayPacific()} carried={carried} />
    </Page>
  );
}
