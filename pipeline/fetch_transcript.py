#!/usr/bin/env python3
"""Stage 1 — pull a rehearsal's auto-captions and write a timestamped TSV.

    python3 fetch_transcript.py <youtube-url> [out.tsv] [--cookies cookies.txt]

`youtube.com/api/timedtext` is dead (HTTP 200, empty body, wants a signed
proof-of-origin token) and the prototype's DOM scraper needs a browser, so
this uses yt-dlp's caption download — the approach PROCESS.md settled on.

Output is the same shape the prototype produced, because the extraction pass
reads it:

    # <video title>
    # <url>
    # seconds\ttext
    0\tokay let's take it from the top

Caption quality is mediocre; musical vocabulary comes back as homophones
("base" for bass, "measure one fifty eight" for measure 158). Nothing here
repairs that — an unrecoverable phrase must stay unrecoverable and be filed as
an open question, never guessed.
"""
import html
import io
import re
import sys

import yt_dlp

# Prefer real captions over ASR when a video has both.
SUB_PREFS = ("en", "en-orig", "en-US", "en-GB")

# YouTube challenges the default player client ("The page needs to be reloaded"),
# and the `web` client returns metadata with an EMPTY automatic_captions map —
# which looks like "this video has no captions" rather than an error. Only
# `android` reliably returns the caption tracks. Verified 2026-09-23 against a
# real rehearsal from a residential IP; a datacenter IP is likely to be worse,
# so if this starts failing when hosted, the next lever is a cookie file
# (`cookiefile` below) exported from a signed-in browser.
PLAYER_CLIENTS = ("android", "web", "ios", "tv")


def _pick_track(info):
    """(url, kind) for the best English caption track, or (None, None).

    VTT only: parse_vtt is the only parser here, and YouTube also offers
    json3/srv1/ttml. Accepting those and then handing them to a VTT parser
    yields an empty transcript and the misleading "captions came back empty".
    """
    for source, kind in ((info.get("subtitles") or {}, "manual"),
                         (info.get("automatic_captions") or {}, "auto")):
        for lang in SUB_PREFS:
            for track in source.get(lang) or []:
                if track.get("ext") == "vtt":
                    return track["url"], f"youtube {kind} captions ({lang})"
    return None, None


TIMING = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> ")
TAG = re.compile(r"<[^>]+>")


def parse_vtt(text):
    """[(seconds, line)] from WebVTT, de-duplicated.

    YouTube's auto-caption VTT repeats each line across overlapping cues as a
    rolling two-line window, so the same words arrive two or three times. Keep
    the first timestamp a line is seen at.
    """
    out, seen, at = [], set(), None
    for raw in io.StringIO(text):
        line = raw.rstrip("\n")
        m = TIMING.match(line)
        if m:
            h, mi, s, ms = (int(g) for g in m.groups())
            at = h * 3600 + mi * 60 + s + (1 if ms >= 500 else 0)
            continue
        if at is None or not line.strip() or line.strip().isdigit() or line.startswith("WEBVTT"):
            continue
        clean = html.unescape(TAG.sub("", line)).strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        out.append((at, clean))
    return out


def fetch(url, cookiefile=None):
    """(title, source_label, [(seconds, text)]) for one video.

    Tries each player client in turn: a client can fail outright, or succeed
    and hand back no caption tracks at all, and both mean "try the next one".
    """
    problems = []
    for client in PLAYER_CLIENTS:
        opts = {
            "skip_download": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 30,
            "extractor_args": {"youtube": {"player_client": [client]}},
        }
        if cookiefile:
            opts["cookiefile"] = cookiefile
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                track_url, source = _pick_track(info)
                if not track_url:
                    problems.append(f"{client}: no caption tracks")
                    continue
                data = ydl.urlopen(track_url).read().decode("utf-8", "replace")
            return info.get("title") or "Rehearsal", f"{source} via {client}", parse_vtt(data)
        except Exception as exc:  # noqa: BLE001 — any failure means try the next client
            problems.append(f"{client}: {str(exc).splitlines()[0][:90]}")

    raise SystemExit(
        "Could not get captions from any player client:\n  "
        + "\n  ".join(problems)
        + "\n\nIf every client is challenged, export cookies from a signed-in browser and pass --cookies FILE."
    )


def write_tsv(path, title, url, segments):
    with open(path, "w") as fh:
        fh.write(f"# {title}\n# {url}\n# seconds\ttext\n")
        for at, text in segments:
            fh.write(f"{at}\t{text}\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    video_url = sys.argv[1]
    args = sys.argv[2:]
    cookiefile = None
    if "--cookies" in args:
        i = args.index("--cookies")
        cookiefile = args[i + 1]
        del args[i : i + 2]
    out = args[0] if args else "transcript.tsv"
    title, source, segments = fetch(video_url, cookiefile)
    if not segments:
        raise SystemExit("Captions came back empty.")
    write_tsv(out, title, video_url, segments)
    words = sum(len(t.split()) for _, t in segments)
    # Match what find_sections.py matches: real captions carry [singing] more
    # often than [Music], and a literal check here reports a misleading 0.
    sung = re.compile(r"\[[^\]]*\b(?:music|singing)\b[^\]]*\]", re.I)
    music = sum(1 for _, t in segments if sung.search(t))
    print(f"{title}\n  {source}")
    print(f"  {len(segments)} segments, {words} words, {music} sung-passage tags")
    print(f"  last at {segments[-1][0] // 60}m")
    print(f"wrote {out}")
