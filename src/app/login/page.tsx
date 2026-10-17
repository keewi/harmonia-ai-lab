import Image from "next/image";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="flex flex-col justify-between bg-brand px-6 py-8 text-white md:px-12 md:py-12">
        <Image src="/brand/harmonia-arched-white.png" alt="Harmonia" width={180} height={90} className="h-auto w-[140px] md:w-[180px]" priority />
        <div className="mt-10 md:mt-0">
          <h1 className="font-display text-4xl uppercase leading-[0.95] md:text-6xl">
            Rehearsal in.
            <br />
            Notes out.
          </h1>
          <p className="mt-4 max-w-sm text-white/85">
            Every rehearsal&apos;s director notes, written onto our sheet music.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-grey-500">Harmonia Notes</p>
          <h2 className="mb-6 mt-1 font-display text-2xl uppercase text-ink">Sign in</h2>
          <LoginForm next={next ?? ""} />
        </div>
      </section>
    </main>
  );
}
