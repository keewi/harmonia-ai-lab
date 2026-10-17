import { fmtDate } from "@/lib/format";
import { getShared } from "@/lib/share";

/**
 * Shared-page visit → Slack, one line per visit, like qierastudio's api/hit.js:
 *
 *   🎶 *Direct*: 2 min 5 sec on the Aug 24, 2026 rehearsal notes from CA.
 *      Opened Cruella De Vil and Cry Me a River. Downloaded Cruella De Vil.
 *
 * Location is state / country only, from Vercel's edge geo headers. No IP,
 * cookie, id or city. The webhook lives only in the Vercel env var
 * SLACK_WEBHOOK_URL; unset (as it is locally) this answers 204 and posts
 * nothing. A token that isn't a live share is ignored, so nobody can post to
 * Slack by calling this directly.
 */
const BOTS =
  /bot|crawl|spider|slurp|bing|preview|facebookexternalhit|whatsapp|telegram|slackbot|discordbot|embedly|quora|pinterest|redditbot|linkedinbot|vercel-screenshot|lighthouse|headless|gtmetrix|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http/i;

const clean = (v: unknown) => String(v ?? "").replace(/[`*~<>\r\n]/g, "").trim().slice(0, 80);

function list(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function POST(request: Request) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook || BOTS.test(request.headers.get("user-agent") || "")) return new Response(null, { status: 204 });

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(await request.text());
  } catch {}
  const shared = await getShared(String(body.token || ""));
  if (!shared) return new Response(null, { status: 204 });

  // A ?ref= tag wins; otherwise the referrer's host.
  let source = clean(body.tag) || clean(body.ref).replace(/^www\./, "");
  if (!source || /golden-gate-harmonia\.vercel\.app$/.test(source)) source = "Direct";
  source = source.charAt(0).toUpperCase() + source.slice(1);

  const region = request.headers.get("x-vercel-ip-country-region");
  const country = request.headers.get("x-vercel-ip-country");
  const where = region && country === "US" ? region : region && country ? `${region}, ${country}` : country || "somewhere";

  const secs = Math.max(0, Math.min(Number(body.seconds) || 0, 24 * 3600));
  const spent = secs >= 60 ? `${Math.floor(secs / 60)} min ${secs % 60} sec` : `${secs} sec`;

  const names = (v: unknown) => (Array.isArray(v) ? v.map(clean).filter(Boolean).slice(0, 10) : []);
  const songs = names(body.songs);
  const downloads = names(body.downloads);
  const did: string[] = [];
  if (songs.length) did.push(`Opened ${list(songs)}.`);
  if (downloads.length) did.push(`Downloaded ${list(downloads)}.`);
  if (body.video) did.push("Watched the video.");

  const text = `🎶 *${source}*: ${spent} on the ${fmtDate(shared.meta.date, "short")} rehearsal notes from ${where}.\n${did.join(" ") || "No clicks."}`;
  try {
    await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  } catch {}
  return new Response(null, { status: 204 });
}
