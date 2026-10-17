import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/components/header";
import { ResultsView } from "@/components/results-view";
import { fmtDate } from "@/lib/format";
import { getShared } from "@/lib/share";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shared = await getShared((await params).token);
  return {
    title: shared ? `Rehearsal notes, ${fmtDate(shared.meta.date, "short")}` : "Harmonia AI Lab",
    robots: { index: false, follow: false },
  };
}

/** A shared rehearsal: the same results screen, read-only, no password. */
export default async function SharedPage({ params }: Props) {
  const { token } = await params;
  const shared = await getShared(token);
  if (!shared) notFound();
  return (
    <Page wide nav={false}>
      <ResultsView meta={shared.meta} result={shared.result} fileUrl={(_rel, i) => `/s/${token}/file/${i}`} />
    </Page>
  );
}
