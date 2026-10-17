import Link from "next/link";
import Image from "next/image";
import { History, Upload } from "lucide-react";
import { btn } from "@/components/ui";

export function Header() {
  return (
    <header className="border-b border-border-default bg-white">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 md:px-8">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <Image src="/brand/harmonia-h-mark-red.png" alt="" width={26} height={32} className="h-8 w-auto" priority />
          <span className="font-display text-lg uppercase leading-none text-ink">
            Harmonia <span className="text-brand">AI Lab</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/" className={btn.ghost}>
            <Upload size={16} aria-hidden /> <span className="hidden sm:inline">New upload</span>
          </Link>
          <Link href="/history" className={btn.ghost}>
            <History size={16} aria-hidden /> <span className="hidden sm:inline">Past rehearsals</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <Header />
      <main className={`mx-auto box-border w-full px-4 py-8 md:px-8 md:py-10 ${wide ? "max-w-[1200px]" : "max-w-[760px]"}`}>
        {children}
      </main>
    </>
  );
}
