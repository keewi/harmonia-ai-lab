import Link from "next/link";
import Image from "next/image";
import { History, Upload } from "lucide-react";
import { btn } from "@/components/ui";

export function Header({ nav = true }: { nav?: boolean }) {
  return (
    <header className="border-b border-border-default bg-white">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 md:px-8">
        {nav ? (
          <Link href="/" className="flex items-center gap-3 no-underline">
          <Image src="/brand/harmonia-h-mark-red.png" alt="" width={26} height={32} className="h-8 w-auto" priority />
          <span className="font-display text-lg uppercase leading-none text-ink">
            Harmonia <span className="text-brand">Notes</span>
          </span>
          </Link>
        ) : (
          <div className="flex items-center gap-3">
          <Image src="/brand/harmonia-h-mark-red.png" alt="" width={26} height={32} className="h-8 w-auto" priority />
          <span className="font-display text-lg uppercase leading-none text-ink">
            Harmonia <span className="text-brand">Notes</span>
          </span>
          </div>
        )}
        {nav ? (
        <nav className="flex items-center gap-1">
          <Link href="/" className={btn.ghost}>
            <Upload size={16} aria-hidden /> <span className="hidden sm:inline">New upload</span>
          </Link>
          <Link href="/history" className={btn.ghost}>
            <History size={16} aria-hidden /> <span className="hidden sm:inline">Past rehearsals</span>
          </Link>
        </nav>
        ) : (
          <span className="hidden text-sm text-grey-500 sm:inline">Shared rehearsal notes</span>
        )}
      </div>
    </header>
  );
}

export function Page({ children, wide = false, nav = true }: { children: React.ReactNode; wide?: boolean; nav?: boolean }) {
  return (
    <>
      <Header nav={nav} />
      <main className={`mx-auto box-border w-full px-4 py-8 md:px-8 md:py-10 ${wide ? "max-w-[1200px]" : "max-w-[760px]"}`}>
        {children}
      </main>
    </>
  );
}
