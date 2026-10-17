import Link from "next/link";
import { Page } from "@/components/header";
import { btn } from "@/components/ui";

export default function NotFound() {
  return (
    <Page>
      <h1 className="font-display text-3xl uppercase text-ink">Not found</h1>
      <p className="mt-2 text-grey-700">We couldn&apos;t find that rehearsal.</p>
      <Link href="/" className={`${btn.primary} mt-6`}>
        Upload a rehearsal
      </Link>
    </Page>
  );
}
