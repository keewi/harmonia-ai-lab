import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Upload } from "lucide-react";
import { Page } from "@/components/header";
import { ResultsView } from "@/components/results-view";
import { btn } from "@/components/ui";
import { getRun } from "@/lib/runs";
import { shareUrl } from "@/lib/share";
import { ShareControl } from "./share-control";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  if (run.status.status !== "done" || !run.result) redirect(`/runs/${id}/processing`);

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
    </Page>
  );
}
