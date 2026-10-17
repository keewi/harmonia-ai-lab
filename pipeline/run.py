#!/usr/bin/env python3
"""One rehearsal, end to end, with files instead of a database.

    python3 run.py data/runs/<id>

Reads `run.json` (written by the web app), and writes two files back:
`status.json` while it works (the processing page polls it) and `result.json`
when it is done. Annotated scores land in `out/`.

The stages are the Rehearsal Companion's, minus the review queue — this is a
lab for seeing what the model does, so its markings go straight onto the page:

  1. scores      read each PDF: title, lyrics, and any earlier annotation
  2. transcript  YouTube captions, or Whisper when there are none
  3. overview    one Claude pass over the whole rehearsal: summary + song map
  4. extraction  one Claude pass per song, using the Companion's prompt
  5. annotation  draw every marking onto its bar, stamp the date, embed history

**An annotated PDF carries its own history.** The clean score and every
marking so far are embedded in it as attachments, so uploading it again (or
carrying it over from the results page) re-renders from the clean score with
old and new markings together. Nothing is drawn on top of earlier ink, and a
later rehearsal supersedes an earlier one on the same topic.
"""
import concurrent.futures
import io
import json
import os
import re
import shutil
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import date as Date

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import annotate          # noqa: E402
import fetch_transcript  # noqa: E402
import lyric_match       # noqa: E402
import score_lyrics      # noqa: E402

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5")
MAX_REPLY_TOKENS = 24000
MAX_TRANSCRIPT_CHARS = 400000
LAB_FILE = "harmonia-lab.json"
SOURCE_FILE = "harmonia-source.pdf"
STAMP_RE = re.compile(r"Annotated from (.+?) rehearsals?", re.I)

KINDS = {"breath", "notes-rests", "balance", "tone-vowel", "pitch",
         "character", "rubato-tempo", "staging", "open-question"}
TIERS = {"act", "note", "standing"}
RESOLUTIONS = {"open", "settled"}
PARTS = {"tenor", "lead", "baritone", "bass"}


# ---------------------------------------------------------------------------
# plumbing
# ---------------------------------------------------------------------------
class Run:
    def __init__(self, directory):
        self.dir = os.path.abspath(directory)
        self.meta = json.load(open(self.path("run.json")))
        os.makedirs(self.path("out"), exist_ok=True)
        os.makedirs(self.path("work"), exist_ok=True)

    def path(self, *parts):
        return os.path.join(self.dir, *parts)

    def status(self, stage, progress, message, **extra):
        body = {"status": "running", "stage": stage, "progress": progress,
                "message": message, "updated_at": time.time(), **extra}
        tmp = self.path("status.json.tmp")
        json.dump(body, open(tmp, "w"))
        os.replace(tmp, self.path("status.json"))      # never a half-written file
        print(f"[{progress:3d}%] {stage}: {message}", flush=True)


def load_env():
    """The web app passes its env through; this is for running by hand."""
    for name in (".env.local", ".env"):
        path = os.path.join(HERE, "..", name)
        if os.path.exists(path):
            for line in open(path):
                m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)", line)
                if m and not os.environ.get(m.group(1)):
                    os.environ[m.group(1)] = m.group(2).strip().strip("\"'")


def ask_claude(system, user, max_tokens=MAX_REPLY_TOKENS):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or key.startswith("sk-ant-your"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set in .env.local, so the AI steps cannot run.")
    body = {"model": MODEL, "max_tokens": max_tokens, "system": system,
            "messages": [{"role": "user", "content": user}]}
    last = None
    for attempt in range(4):
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
            method="POST", headers={"content-type": "application/json", "x-api-key": key,
                                    "anthropic-version": "2023-06-01"})
        try:
            with urllib.request.urlopen(req, timeout=600) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            last = f"HTTP {exc.code}: {detail}"
            if exc.code in (429, 500, 502, 503, 529) and attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"The Claude API refused the request. {last}") from None
    else:
        raise RuntimeError(f"The Claude API kept failing. {last}")
    if payload.get("stop_reason") == "max_tokens":
        raise RuntimeError(f"The model hit the {max_tokens}-token reply limit mid-answer.")
    return "".join(p.get("text", "") for p in payload.get("content", []))


def json_from(reply, opener):
    """The JSON array or object out of a reply, fenced or not."""
    closer = "]" if opener == "[" else "}"
    fenced = re.search(r"```(?:json)?\s*(\%s.*?\%s)\s*```" % (opener, closer), reply, re.S)
    text = fenced.group(1) if fenced else reply[reply.find(opener):reply.rfind(closer) + 1]
    return json.loads(text) if text.strip() else ([] if opener == "[" else {})


def clock(seconds):
    seconds = int(seconds or 0)
    h, m, s = seconds // 3600, seconds % 3600 // 60, seconds % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def us_date(iso):
    d = Date.fromisoformat(iso)
    return f"{d.month}/{d.day}/{d.year}"


def from_us(text):
    m = re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$", text)
    return Date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat() if m else None


# ---------------------------------------------------------------------------
# 1 — scores
# ---------------------------------------------------------------------------
def guess_title(path, fallback):
    """The biggest line of real words on page 1 is almost always the title.

    Music fonts set noteheads and clefs as letters ("j j j b c"), often at a
    bigger size than the title, so a line only counts when most of its tokens
    look like words.
    """
    def wordlike(tokens):
        good = [t for t in tokens if re.fullmatch(r"[A-Za-z][A-Za-z'\u2019/&+.,!-]+", t)]
        return len(good) >= max(1, 0.7 * len(tokens)) and sum(len(t) for t in good) >= 4
    try:
        with pdfplumber.open(path) as pdf:
            page = pdf.pages[0]
            words = [w for w in page.extract_words(extra_attrs=["size", "fontname"])
                     if w["top"] < page.height * 0.4]
    except Exception:  # noqa: BLE001
        words = []
    layers = {}
    for w in words:
        layers.setdefault((round(w["size"], 1), w["fontname"]), []).append(w)
    for (_size, _font), line in sorted(layers.items(), key=lambda kv: -kv[0][0]):
        line.sort(key=lambda w: (round(w["top"] / 4), w["x0"]))
        tokens = [w["text"] for w in line]
        title = " ".join(tokens).strip()
        if wordlike(tokens) and 2 <= len(title) <= 80:
            letters = [ch for ch in title if ch.isalpha()]
            if letters and sum(ch.isupper() for ch in letters) / len(letters) > 0.7:
                title = " ".join(t[:1] + t[1:].lower() for t in title.split())
            return title
    name = re.sub(r"\.pdf$", "", fallback, flags=re.I)
    name = re.sub(r"\(.*?\)", "", name)
    name = re.split(r"\s+-\s+|\s+annotated\b", name, flags=re.I)[0]
    return name.strip() or fallback


def read_stamp(path):
    """Dates already stamped on page 1 by something other than this lab."""
    try:
        with pdfplumber.open(path) as pdf:
            page = pdf.pages[0]
            for line in page.extract_text_lines():
                m = STAMP_RE.search(line["text"])
                if m:
                    dates = [from_us(p) for p in re.split(r",|\band\b", m.group(1))]
                    return [d for d in dates if d], (line["x0"], line["top"], line["x1"], line["bottom"])
    except Exception:  # noqa: BLE001
        pass
    return [], None


def load_score(run, entry):
    """Everything later stages need about one uploaded PDF."""
    upload = run.path(entry["file"])
    reader = PdfReader(upload)
    history = None
    try:
        attachments = reader.attachments
        if LAB_FILE in attachments and SOURCE_FILE in attachments:
            history = json.loads(attachments[LAB_FILE][0])
            clean = run.path("work", f"{entry['key']}-clean.pdf")
            open(clean, "wb").write(attachments[SOURCE_FILE][0])
    except Exception:  # noqa: BLE001 — a damaged attachment just means "no history"
        history = None

    if history:
        score = {"key": entry["key"], "name": entry["name"], "title": history["song"],
                 "clean": clean, "prior": history.get("markings", []),
                 "prior_dates": history.get("dates", []), "foreign_stamp": None}
    else:
        dates, box = read_stamp(upload)
        score = {"key": entry["key"], "name": entry["name"],
                 "title": guess_title(upload, entry["name"]), "clean": upload,
                 "prior": [], "prior_dates": dates, "foreign_stamp": box}
    try:
        score["lyrics"] = score_lyrics.extract(score["clean"])
    except Exception:  # noqa: BLE001
        score["lyrics"] = None
    return score


# ---------------------------------------------------------------------------
# 2 — transcript
# ---------------------------------------------------------------------------
def get_transcript(run):
    cached = run.path("work", "transcript.json")
    if os.path.exists(cached):
        data = json.load(open(cached))
        return data["title"], data["source"], [tuple(s) for s in data["segments"]]
    url = run.meta["video_url"]
    try:
        title, source, segments = fetch_transcript.fetch(url)
    except BaseException as exc:          # fetch() raises SystemExit
        if "no caption tracks" not in str(exc):
            raise RuntimeError("Could not read that YouTube video. Check that the link is "
                               "right and the video is public or unlisted.\n\n"
                               + str(exc)[:600]) from None
        run.status("transcript", 15, "No captions on this video, so transcribing the audio")
        import transcribe
        title, source, segments = transcribe.fetch(url)
    if not segments:
        raise RuntimeError("That video has no speech to read.")
    json.dump({"title": title, "source": source, "segments": segments}, open(cached, "w"))
    return title, source, segments


def condensed(segments, every=12):
    """Caption lines grouped into ~12-second rows, each with its timestamp."""
    rows, start, words = [], None, []
    for at, text in segments:
        if start is None:
            start = at
        words.append(text)
        if at - start >= every:
            rows.append(f"[{int(start)}s {clock(start)}] {' '.join(words)}")
            start, words = None, []
    if words:
        rows.append(f"[{int(start)}s {clock(start)}] {' '.join(words)}")
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# 3 — overview
# ---------------------------------------------------------------------------
OVERVIEW_PROMPT = """You are reading the full auto-captioned transcript of a barbershop chorus
rehearsal. Return one JSON object and nothing else:

{
  "summary": "...",
  "songs": [
    {"title": "...", "sections": [{"start_s": 0, "end_s": 0}], "worked_on": "..."}
  ]
}

- summary: 3 to 5 sentences for a singer who missed the rehearsal. What was
  worked on, the main themes of the director's feedback, and any
  announcements. Plain, warm, specific. No em dashes, no exclamation marks.
- songs: every song the chorus actually rehearsed, in the order first
  rehearsed. Exclude warmups, vocal exercises and tags unless they were
  rehearsed as repertoire. When a song matches one of the SCORES listed, use
  that title exactly as written. Otherwise use the song's real name if you
  can tell it from lyrics or talk; auto-captions mangle lyrics, so reason
  from what the words sound like.
- sections: every stretch of the recording spent on that song, in seconds,
  taken from the [Ns] timestamps. Include the talk about the song, not only
  the singing. A song can have several sections.
- worked_on: one short sentence on what was worked on in that song.
"""


def overview(run, segments, scores):
    listed = "\n".join(
        f"- {s['title']}" + (f"  (lyrics begin: \"{s['lyrics']['text'][:220]}\")"
                             if s.get("lyrics") and s["lyrics"].get("text") else "")
        for s in scores) or "- (none uploaded)"
    user = (f"REHEARSAL DATE: {run.meta['date']}\n"
            f"DESCRIPTION FROM THE UPLOADER: {run.meta.get('description') or '(none)'}\n\n"
            f"SCORES\n{listed}\n\n"
            f"TRANSCRIPT\n{condensed(segments)[:MAX_TRANSCRIPT_CHARS]}")
    data = json_from(ask_claude(OVERVIEW_PROMPT, user, 16000), "{")
    if not isinstance(data, dict):
        raise RuntimeError("The overview reply was not a JSON object.")
    return data


def match_score(title, scores):
    """The uploaded score a song title refers to, by loose name match."""
    def norm(t):
        return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()
    t = norm(title)
    for s in scores:
        if norm(s["title"]) == t:
            return s
    for s in scores:
        a = norm(s["title"])
        if a and (a in t or t in a):
            return s
    return None


# ---------------------------------------------------------------------------
# 4 — extraction
# ---------------------------------------------------------------------------
def one_of(value, allowed, fallback):
    return value if value in allowed else fallback


def extract_song(run, segments, song, score):
    windows = song.get("sections") or []
    lines = [(at, t) for at, t in segments
             if any(w.get("start_s", 0) - 5 <= at <= w.get("end_s", 0) + 5 for w in windows)]
    if not lines:
        return []
    transcript = "\n".join(f"[{int(at)}s] {t}" for at, t in lines)[:120000]
    system = open(os.path.join(HERE, "extract_prompt.md")).read()
    reply = ask_claude(system, (
        f"SONG: {song['title']}\n"
        f"REHEARSAL DATE: {run.meta['date']}\n"
        + "".join(f"BLOCK: {clock(w.get('start_s'))}-{clock(w.get('end_s'))}\n" for w in windows)
        + f"\nTRANSCRIPT (each line starts with seconds into the recording)\n{transcript}"))
    try:
        proposed = json_from(reply, "[")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"The notes for {song['title']} came back as invalid JSON: {exc}") from None

    date = run.meta["date"]
    lyrics = score.get("lyrics") if score else None
    out = []
    for i, m in enumerate(proposed if isinstance(proposed, list) else []):
        text = (m.get("text") or "").strip()
        if not text:
            continue
        measure = m.get("measure") if isinstance(m.get("measure"), int) else None
        end = m.get("measure_end") if isinstance(m.get("measure_end"), int) else None
        if measure is None and lyrics:
            bar, note = lyric_match.resolve(lyrics, text)
            if bar is not None:
                measure = bar
            elif note:
                text = f"{text} {note}"
        if end is not None and (measure is None or end <= measure):
            end = None
        tag = (m.get("tag") or "").replace("—", ",").strip()[:48]
        out.append({
            "id": f"{date}:{song['title']}:{i}",
            "measure": measure, "measure_end": end,
            "tier": one_of(m.get("tier"), TIERS, "note"),
            "status": one_of(m.get("status"), RESOLUTIONS, "settled"),
            "kind": one_of(m.get("kind"), KINDS, "open-question"),
            "parts": [p for p in (m.get("scope") or []) if p in PARTS] or None,
            "tag": tag or (text[:40] if measure is not None else None),
            "text": text,
            "topic": m.get("topic") or f"auto:{date}:{i}",
            "supersedes": [],
            "quote": m.get("quote"),
            "at_s": m.get("at_s"),
            "source": {"date": date},
        })
    return out


# ---------------------------------------------------------------------------
# 5 — annotation
# ---------------------------------------------------------------------------
def for_renderer(markings):
    """Copies in the shape annotate.build reads (it mutates what it is given)."""
    return [{**m, "scope": annotate.staff_of(m.get("parts")),
             "source": dict(m["source"])} for m in markings]


def ink_top(page):
    tops = [c["top"] for c in page.chars] + [o["top"] for o in page.rects + page.lines + page.curves]
    return min(tops) if tops else page.height


def stamp(pdf_in, pdf_out, dates, white_out=None):
    """'Annotated from M/D/YYYY, M/D/YYYY rehearsals' across the top of page 1."""
    label = ("Annotated from " + ", ".join(us_date(d) for d in dates)
             + (" rehearsal" if len(dates) == 1 else " rehearsals"))
    with pdfplumber.open(pdf_in) as pdf:
        first = pdf.pages[0]
        top = ink_top(first)
        W, H = float(first.width), float(first.height)
    reader = PdfReader(pdf_in)
    page = reader.pages[0]
    box = page.mediabox
    x_off, y_off = float(box.left), float(box.bottom)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    if white_out:
        x0, t, x1, b = white_out
        c.setFillColorRGB(1, 1, 1)
        c.rect(x0 - 2, H - b - 2, x1 - x0 + 4, b - t + 4, stroke=0, fill=1)
    size = 9.0
    width = stringWidth(label, "Helvetica-Bold", size) + 16
    # Sit in the margin above the first ink when there is room, else at the very top.
    baseline = H - max(min(top, 40) / 2 + 3, 13)
    x = (W - width) / 2
    c.setFillColor(HexColor("#FFEEEF"))
    c.roundRect(x, baseline - 4.5, width, size + 6, 4, stroke=0, fill=1)
    c.setFillColor(HexColor("#BF0001"))
    c.setFont("Helvetica-Bold", size)
    c.drawCentredString(W / 2, baseline, label)
    c.save()
    buf.seek(0)
    overlay = PdfReader(buf).pages[0]
    if x_off or y_off:
        from pypdf import Transformation
        overlay.add_transformation(Transformation().translate(x_off, y_off))
    page.merge_page(overlay)

    writer = PdfWriter()
    for p in reader.pages:
        writer.add_page(p)
    with open(pdf_out, "wb") as f:
        writer.write(f)


def score_measures(path):
    """Every measure number the renderer can find on this score."""
    with pdfplumber.open(path) as pdf:
        found = set()
        for pg in pdf.pages:
            g = annotate.page_geom(pg)
            if g:
                found |= set(g["mn"])
    return found


def annotate_score(run, score, new_markings):
    date = run.meta["date"]
    # Re-processing a date replaces that date's markings instead of doubling them.
    prior = [m for m in score["prior"] if m["source"]["date"] != date]
    everything = prior + new_markings
    dates = sorted(set(d for d in score["prior_dates"] if d != date)
                   | {m["source"]["date"] for m in everything}
                   | ({date} if new_markings else set()))
    safe = re.sub(r"[^A-Za-z0-9]+", "-", score["title"]).strip("-")[:60] or score["key"]
    final = run.path("out", f"{safe} annotated {date}.pdf")
    drawn = run.path("work", f"{score['key']}-drawn.pdf")

    if everything:
        active, dead = annotate.resolve(for_renderer(everything))
        annotate.detect_measure_pt(score["clean"])
        # A note only lands in the music when its bar is printed on the score; the
        # rest go to the summary pages at the back. Record which, for the results page.
        bars = score_measures(score["clean"])
        for m in new_markings:
            m["placed"] = m["measure"] is not None and m["measure"] in bars
        annotate.build({"song": score["title"]}, active, dead, score["clean"], drawn)
    else:
        shutil.copy(score["clean"], drawn)

    if dates:
        stamp(drawn, drawn + ".stamped.pdf", dates, score["foreign_stamp"])
        drawn += ".stamped.pdf"

    writer = PdfWriter(clone_from=drawn)
    writer.add_metadata({"/Title": f"{score['title']} (annotated)",
                         "/Producer": "Harmonia AI Lab"})
    writer.add_attachment(LAB_FILE, json.dumps({
        "version": 1, "song": score["title"], "dates": dates, "markings": everything,
    }).encode())
    writer.add_attachment(SOURCE_FILE, open(score["clean"], "rb").read())
    with open(final, "wb") as f:
        writer.write(f)
    return os.path.relpath(final, run.dir), dates


# ---------------------------------------------------------------------------
def main(directory):
    load_env()
    run = Run(directory)
    started = time.time()

    run.status("scores", 3, "Reading the sheet music")
    scores = []
    for entry in run.meta.get("scores", []):
        scores.append(load_score(run, entry))

    run.status("transcript", 8, "Fetching the rehearsal recording")
    title, source, segments = get_transcript(run)
    minutes = int(segments[-1][0] // 60)
    run.status("transcript", 30, f"Read {minutes} minutes of rehearsal ({source})")

    run.status("overview", 35, "Listening for which songs were rehearsed")
    ov = overview(run, segments, scores)
    songs = [s for s in ov.get("songs", []) if s.get("title")]
    for s in songs:
        s["score"] = match_score(s["title"], scores)
        if s["score"]:
            s["title"] = s["score"]["title"]
    run.status("overview", 50, f"Found {len(songs)} song(s)")

    run.status("extraction", 52, "Pulling director notes, song by song")
    results, done = {}, 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(extract_song, run, segments, s, s["score"]): s for s in songs}
        for fut in concurrent.futures.as_completed(futures):
            s = futures[fut]
            results[s["title"]] = fut.result()
            done += 1
            run.status("extraction", 52 + int(33 * done / max(len(songs), 1)),
                       f"Notes for {s['title']} ({done} of {len(songs)})")

    run.status("annotation", 88, "Writing the notes onto the score")
    annotated = {}
    for score in scores:
        song = next((s for s in songs if s["score"] is score), None)
        new = results.get(song["title"], []) if song else []
        path, dates = annotate_score(run, score, new)
        annotated[score["key"]] = {"file": path, "dates": dates}

    out_songs = []
    for s in songs:
        notes = results.get(s["title"], [])
        sc = s["score"]
        out_songs.append({
            "title": s["title"], "worked_on": s.get("worked_on"),
            "notes": len(notes),
            "placed": sum(1 for m in notes if m.get("placed")),
            "start_s": min((w.get("start_s", 0) for w in s.get("sections") or []), default=None),
            "has_score": bool(sc),
            "annotated": annotated[sc["key"]]["file"] if sc else None,
            "markings": [{k: m.get(k) for k in ("measure", "measure_end", "tier", "status",
                                                 "kind", "parts", "tag", "text", "at_s", "placed")}
                         for m in notes],
        })
    heard = {s["score"]["key"] for s in songs if s["score"]}
    unheard = [{"title": sc["title"], "annotated": annotated[sc["key"]]["file"]}
               for sc in scores if sc["key"] not in heard]

    result = {
        "video_title": title, "transcript_source": source, "minutes": minutes,
        "summary": ov.get("summary", ""), "songs": out_songs,
        "scores": [{"key": sc["key"], "title": sc["title"], "name": sc["name"],
                    "file": annotated[sc["key"]]["file"], "dates": annotated[sc["key"]]["dates"],
                    "heard": sc["key"] in heard} for sc in scores],
        "unheard_scores": unheard, "model": MODEL,
        "seconds": int(time.time() - started),
    }
    json.dump(result, open(run.path("result.json"), "w"), indent=2)
    run.status("done", 100, "Done", status="done")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    try:
        main(sys.argv[1])
    except BaseException as exc:  # noqa: BLE001 — every failure must reach the page
        traceback.print_exc()
        try:
            r = Run(sys.argv[1])
            r.status("error", 100, "Something went wrong", status="error",
                     error=str(exc) or exc.__class__.__name__)
        finally:
            sys.exit(1)
