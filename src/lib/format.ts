/** Calendar dates are YYYY-MM-DD strings; format them in UTC so no time zone shifts the day. */
export function fmtDate(iso: string, style: "long" | "short" = "long") {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: style === "long" ? "long" : undefined,
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
  });
}

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** The video link jumped to a moment, for "watch this part" links. */
export function videoAt(url: string, seconds: number | null | undefined) {
  if (seconds == null) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("t", `${Math.floor(seconds)}s`);
    return u.toString();
  } catch {
    return url;
  }
}

/** Today in the chorus's time zone, as YYYY-MM-DD. */
export function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

export const YOUTUBE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|live\/|shorts\/)|youtu\.be\/)\S+$/i;
