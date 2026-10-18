import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Upload } from "lucide-react";
import { Page } from "@/components/header";
import { ResultsView } from "@/components/results-view";
import { btn } from "@/components/ui";
import { getRun } from "@/lib/runs";
import { getLibraryRun, libraryState, syncLibrary } from "@/lib/library";
import { isHosted } from "@/lib/mode";
import { shareUrl } from "@/lib/share";
import { LibraryControl } from "./library-control";
import { ShareControl } from "./share-control";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Hosted: the library's copy, read-only.
  if (isHosted()) {
    const snap = await getLibraryRun(id);
    if (!snap) notFound();
    return (
      <Page wide>
        <ResultsView meta={snap.meta} result={snap.result} fileUrl={(_rel, i) => `/library/${id}/file/${i}`} />
      </Page>
    );
  }

  const run = await getRun(id);
  if (!run) notFound();
  if (run.status.status !== "done" || !run.result) redirect(`/runs/${id}/processing`);
  let state = await libraryState(id);
  if (state === "pending") {
    // Finished but not up yet: publish now, so the button below tells the truth.
    await syncLibrary();
    state = await libraryState(id);
  }

  return (
    <Page wide>
      <ResultsView
        meta={run.meta}
        result={run.result}
        fileUrl={(rel) => `/api/files/${id}/${rel.split("/").map(encodeURIComponent).join("/")}`}
        actions={
          <>
            <ShareControl id={id} initial={run.share ? shareUrl(run.share.token) : null} />
            <Link href={`/?from=${id}`} className={btn.primary}>
              <Upload size={16} aria-hidden /> Upload a new YT video
            </Link>
          </>
        }
      />
      <LibraryControl id={id} initial={state === "published"} />
    </Page>
  );
}
