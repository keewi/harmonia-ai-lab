/** Shared class strings, so every button and field looks the same without a component library. */
export const btn = {
  primary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-control bg-brand px-5 text-[15px] font-semibold text-white no-underline transition-colors hover:bg-brand-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-control border border-ink bg-white px-5 text-[15px] font-semibold text-ink no-underline transition-colors hover:bg-grey-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-medium text-grey-700 no-underline transition-colors hover:bg-grey-100 hover:text-ink",
};

export const field =
  "block w-full rounded-control border border-grey-300 bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-grey-500 focus:border-ink focus:outline-none";

export const label = "mb-1.5 block text-sm font-semibold text-ink";

export const card = "rounded-card border border-border-default bg-white";

export const eyebrow = "text-xs font-semibold uppercase tracking-[0.08em] text-grey-500";
