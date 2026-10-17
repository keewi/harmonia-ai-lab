"use client";

import { useEffect } from "react";

/**
 * One Slack message per visit to a shared page, sent when the visitor LEAVES
 * (pagehide / tab hidden, or at ten minutes for a tab left open), so it can say
 * how long they stayed and what they did. Same shape as qierastudio's
 * beacon.js. Nothing identifying: the share token, the referrer's host, a
 * ?ref= tag, seconds on the page, and which songs, scores and video they opened.
 *
 * Your own visits: open any share link once with ?notrack=1 and this browser
 * stops reporting for good; ?notrack=0 undoes it.
 */
export function VisitBeacon({ token }: { token: string }) {
  useEffect(() => {
    try {
      if (navigator.webdriver) return;
      const params = new URLSearchParams(location.search);
      try {
        if (params.get("notrack") === "1") localStorage.setItem("notrack", "1");
        if (params.get("notrack") === "0") localStorage.removeItem("notrack");
        if (localStorage.getItem("notrack") === "1") return;
      } catch {}

      const start = Date.now();
      const songs = new Set<string>();
      const downloads = new Set<string>();
      let video = false;
      let sent = false;

      const onClick = (e: MouseEvent) => {
        const a = (e.target as Element | null)?.closest?.("a[href]");
        if (!a) return;
        const score = a.getAttribute("data-score");
        if (score) downloads.add(score);
        if (/youtube\.com|youtu\.be/.test(a.getAttribute("href") || "")) video = true;
      };
      // <details> toggle doesn't bubble, so listen in the capture phase.
      const onToggle = (e: Event) => {
        const d = e.target as HTMLDetailsElement;
        const song = d.getAttribute?.("data-song");
        if (song && d.open) songs.add(song);
      };

      const send = () => {
        if (sent) return;
        sent = true;
        let refHost = "";
        try {
          refHost = document.referrer ? new URL(document.referrer).host : "";
        } catch {}
        const body = JSON.stringify({
          token,
          ref: refHost,
          tag: params.get("ref") || "",
          seconds: Math.round((Date.now() - start) / 1000),
          songs: [...songs],
          downloads: [...downloads],
          video,
        });
        if (navigator.sendBeacon) navigator.sendBeacon("/api/hit", new Blob([body], { type: "application/json" }));
        else void fetch("/api/hit", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
      };
      const onHidden = () => {
        if (document.visibilityState === "hidden") send();
      };

      document.addEventListener("click", onClick, true);
      document.addEventListener("toggle", onToggle, true);
      window.addEventListener("pagehide", send);
      document.addEventListener("visibilitychange", onHidden);
      const timer = setTimeout(send, 10 * 60 * 1000);
      return () => {
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("toggle", onToggle, true);
        window.removeEventListener("pagehide", send);
        document.removeEventListener("visibilitychange", onHidden);
        clearTimeout(timer);
      };
    } catch {}
  }, [token]);
  return null;
}
