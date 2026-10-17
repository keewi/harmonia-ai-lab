#!/usr/bin/env python3
"""Stage 5 — render a song's active markings onto its score PDF.

    python3 annotate.py --song cruella --score path/to/score.pdf
    python3 annotate.py --file markings.json --score score.pdf   # no database

Ported from docs/handoff/rehearsal-companion/lib/build_annotated.py. The
drawing code is deliberately left alone: its placement rules were found by
rendering pages and looking at them, and they are why a band lands on the
right bar instead of near it. Three things changed, all inputs.

**Postgres is the source, and the resolver is SQL.** The prototype read
markings.json and resolved supersession itself. This reads `active_markings`,
which has already applied both mechanisms (latest `source.date` per `topic`,
plus explicit `supersedes[]`). CLAUDE.md requires exactly this: "One resolver,
in SQL. The renderer is handed a pre-resolved list and never resolves — that
is a stronger guarantee than sharing lib/resolve.py across two runtimes,
because there is no second implementation to drift." `resolve()` survives only
for --file mode, where nothing else has done the work.

**The measure point size is detected, not fixed.** The prototype hardcoded
9.7pt, which reads zero measure numbers on Cruella (6.8pt, subsetted fonts)
and would have silently annotated nothing. It now calls `score_bars.profile`,
so all three engravings work. See the gotcha in CLAUDE.md.

**Scope is a voice part, not a staff.** The database stores `scope` as
`voice_part[]`; the renderer wants to know which staff of the SSAA system to
band. `staff_of` maps one to the other.
"""
import argparse
import json
import pathlib
import os
import re
import io
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase.pdfmetrics import stringWidth
import pdfplumber
from pypdf import PdfReader, PdfWriter

from score_bars import profile

# Set per score by detect_measure_pt(); never hardcode it (see the docstring).
MEASURE_FONT_PT = 9.7
# Colour encodes STATUS, not topic.
BLUE  = HexColor("#1668C4")   # settled, actionable: change your music
GREEN = HexColor("#2E7D32")   # musical guidance: how it should sound or look
AMBER = HexColor("#B46C12")   # not decided by the director yet
VERD, SLATE = BLUE, GREEN     # back-compat aliases
COLOUR = {("act", "settled"): BLUE,  ("act", "open"): AMBER,
          ("note", "settled"): GREEN, ("note", "open"): AMBER,
          ("standing", "settled"): BLUE, ("standing", "open"): AMBER}
def tint(c, a): return Color(c.red, c.green, c.blue, alpha=a)


def resolve(markings):
    """Latest-rehearsal-wins. Returns (active, superseded) preserving order."""
    by_topic = {}
    for m in markings:
        by_topic.setdefault(m["topic"], []).append(m)
    dead = set()
    for topic, group in by_topic.items():
        if len(group) > 1:
            winner = max(group, key=lambda m: m["source"]["date"])
            for m in group:
                if m["id"] != winner["id"]:
                    dead.add(m["id"])
                    m["superseded_by"] = winner["id"]
    for m in markings:                       # explicit cross-topic retirement
        for vid in m.get("supersedes", []):
            dead.add(vid)
            for other in markings:
                if other["id"] == vid:
                    other["superseded_by"] = m["id"]
    return ([m for m in markings if m["id"] not in dead],
            [m for m in markings if m["id"] in dead])


def colour_key(c, g, H, drawn=None):
    """One compact legend line in the top margin of every annotated page, so a
    singer who opens straight to page 12 still knows what the colours mean."""
    top_ink = g.get("ink_top_any", min((t for t, _b, _x0, _x1 in g["chars"]), default=60))
    yt = top_ink - 11
    if yt < 13:
        return
    y, x = H - yt, g["LEFT"]
    for col, lab in ((BLUE, "settled \u2014 mark it"),
                     (GREEN, "musical guidance"),
                     (AMBER, "direction TBD")):
        c.setFillColor(col); c.circle(x + 3, y + 1.8, 3.1, stroke=0, fill=1)
        c.setFillColorRGB(.25, .25, .25); c.setFont("Helvetica-Bold", 6.2)
        c.drawString(x + 9, y, lab)
        x += 9 + stringWidth(lab, "Helvetica-Bold", 6.2) + 13
    c.setFillColorRGB(.55, .55, .55); c.setFont("Helvetica", 6.2)
    c.drawString(x, y, "filled band = change your music   \u00b7   dashed tick = guidance"
                       "   \u00b7   one staff = that part only")
    if drawn is not None:
        drawn.append((g["LEFT"], y, g["RIGHT"] - g["LEFT"], 9.0))


def page_geom(pg):
    hor = [l for l in pg.lines if abs(l["y0"] - l["y1"]) < 0.6 and (l["x1"] - l["x0"]) > 200]
    if not hor:
        return None
    ys = sorted({round(l["top"], 1) for l in hor})
    staves, cur = [], [ys[0]]
    for y in ys[1:]:
        if y - cur[-1] <= 12:
            cur.append(y)
        else:
            staves.append(cur); cur = [y]
    staves.append(cur)
    staves = [(s[0], s[-1]) for s in staves if len(s) >= 4]
    # Measure numbers must sit inside the music area. Some publishers set the
    # PAGE number in the same face and size (MuseScore/Academico does), which
    # otherwise resolves "m.3" to page 3's header.
    top_staff = min(l["top"] for l in hor)
    bot_staff = max(l["top"] for l in hor)
    mn = {}
    for w in pg.extract_words(extra_attrs=["size"]):
        t = w["text"].strip()
        if (re.fullmatch(r"\d{1,3}", t) and abs(w["size"] - MEASURE_FONT_PT) < 0.2
                and top_staff - 40 <= w["top"] <= bot_staff + 40):
            mn.setdefault(int(t), (w["x0"], w["top"], w["bottom"]))
    chars = [(c["top"], c["bottom"], c["x0"], c["x1"]) for c in pg.chars]
    # A marked-up score carries ink that pg.chars cannot see. Cruella's page 1
    # has three lines of red choreography text sitting at y=11.7, written by
    # the choreographer as PDF *annotations* — a separate layer from the page
    # content stream, so chars, curves and rects all report the page as empty
    # down to the title at y=47, and the colour key lands on top of them.
    # (It is the same layer the "MEOW!" bubble lives in, which is why no lyric
    # search can find that word.) Everything that marks the page counts.
    ink_tops = [c[0] for c in chars]
    for kind in (pg.curves, pg.rects, pg.lines, pg.images, pg.annots or []):
        ink_tops += [o["top"] for o in kind if o.get("top") is not None]
    H = pg.height
    body = max([c[1] for c in chars if c[1] <= H - 60] or [H - 90])
    foot = min([c[0] for c in chars if c[0] > H - 60] or [H - 22])
    return dict(LEFT=min(l["x0"] for l in hor), RIGHT=max(l["x1"] for l in hor),
                systems=[(staves[i], staves[i + 1]) for i in range(0, len(staves) - 1, 2)],
                mn=mn, chars=chars, body_bottom=body, footer_top=foot, W=pg.width, H=H,
                ink_top_any=min(ink_tops) if ink_tops else H)


def sys_of(g, top):
    for i, ((at, _), (_, bb)) in enumerate(g["systems"]):
        if at - 30 <= top <= bb + 30:
            return i
    return None


def _own(g):
    """Assign each character to its nearest system. A fixed +/- window leaks
    into the neighbouring system's measure numbers and tempo marks; the page
    footer belongs to no system at all."""
    if "_ib" in g:
        return
    cen = [(a[0] + b[1]) / 2 for a, b in g["systems"]]
    own = [[] for _ in cen]
    for t, b, _, _ in g["chars"]:
        if b > g["H"] - 60:
            continue
        y = (t + b) / 2
        own[min(range(len(cen)), key=lambda j: abs(y - cen[j]))].append((b, t))
    g["_ib"] = [max(v)[0] if v else g["systems"][i][1][1] + 16 for i, v in enumerate(own)]
    g["_it"] = [min(v, key=lambda p: p[1])[1] if v else g["systems"][i][0][0] - 16
                for i, v in enumerate(own)]


def ink_bottom(g, si): _own(g); return g["_ib"][si]
def ink_top(g, si):    _own(g); return g["_it"][si]


def free_rect(g, x0, x1, yt, yb):
    return not any(cx1 > x0 and cx0 < x1 and b > yt and t < yb
                   for t, b, cx0, cx1 in g["chars"])


def span_x(g, m):
    x0, top, _ = g["mn"][m]
    si = sys_of(g, top)
    nxt = [v[0] for v in g["mn"].values() if sys_of(g, v[1]) == si and v[0] > x0 + 4]
    return max(x0 - 4, g["LEFT"]), (min(nxt) if nxt else g["RIGHT"]), si


def band_y(g, si, scope):
    (at, ab), (bt, bb) = g["systems"][si]
    mid = (ab + bt) / 2
    if scope == "top":    return at - 15, mid
    if scope == "bottom": return mid, ink_bottom(g, si) + 3
    return at - 15, ink_bottom(g, si) + 3


def summary_page(meta, active, dead, general, W, H):
    """One appended page: song-wide guidance, every measure marking, and the
    audit trail of what later rehearsals overrode."""
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=(W, H))
    L, R, y = 54, W - 54, H - 58
    FLOOR = 72                      # keep clear of the footer line

    def newpage():
        nonlocal y
        c.setFillColorRGB(.6, .6, .6); c.setFont("Helvetica", 7)
        c.drawString(L, 40, "Generated from markings.json. Annotations are rehearsal "
                            "notes added to a licensed copy; the score is unmodified.")
        c.showPage()
        y = H - 58
        c.setFillColorRGB(.42, .42, .42); c.setFont("Helvetica-Bold", 7.6)
        c.drawString(L, y, "DIRECTOR MARKINGS, CONTINUED")
        c.setStrokeColorRGB(.78, .78, .78); c.setLineWidth(.5)
        c.line(L, y - 4, R, y - 4); y -= 15
    dates = sorted({m["source"]["date"] for m in active})
    c.setFillColorRGB(.08, .08, .08); c.setFont("Helvetica-Bold", 15)
    c.drawString(L, y, meta["song"]); y -= 15
    c.setFillColorRGB(.42, .42, .42); c.setFont("Helvetica", 8.4)
    c.drawString(L, y, "Director markings, cumulative. Rehearsals "
                 + ", ".join(d for d in dates)
                 + ".  Later rehearsals override earlier ones."); y -= 20

    def rule(t):
        nonlocal y
        if y < FLOOR + 40: newpage()
        c.setFillColorRGB(.42, .42, .42); c.setFont("Helvetica-Bold", 7.6)
        c.drawString(L, y, t.upper())
        c.setStrokeColorRGB(.78, .78, .78); c.setLineWidth(.5)
        c.line(L, y - 4, R, y - 4); y -= 15

    def para(txt, col, lab, strike=False):
        nonlocal y
        if y < FLOOR + 26: newpage()
        words, line, lines = txt.split(), "", []
        for w in words:
            tr = (line + " " + w).strip()
            if stringWidth(tr, "Helvetica", 8.2) <= R - L - 26: line = tr
            else: lines.append(line); line = w
        if line: lines.append(line)
        c.setFillColor(col); c.circle(L + 5, y + 2.6, 5, stroke=0, fill=1)
        c.setFillColorRGB(1, 1, 1); c.setFont("Helvetica-Bold", 6.4)
        c.drawCentredString(L + 5, y + 0.4, lab)
        c.setFillColorRGB(.55, .55, .55) if strike else c.setFillColorRGB(.13, .13, .13)
        c.setFont("Helvetica", 8.2)
        for i, ln in enumerate(lines):
            c.drawString(L + 16, y - i * 9.6, ln)
        y -= 9.6 * len(lines) + 7

    tbd = [m for m in active if m["status"] == "open"]
    gen = [m for m in general if m["status"] != "open"]

    if gen:
        rule("song-wide guidance")
        for m in gen:
            para(f"{m['text']}   [{m['source']['date']}]",
                 COLOUR[(m["tier"], m["status"])], "\u00b7")

    bars = sorted([m for m in active if m["measure"] and m["status"] != "open"],
                  key=lambda m: m["measure"])
    if bars:
        y -= 4; rule("measure markings")
        for m in bars:
            rng = f"m.{m['measure']}" + (f"-{m['measure_end']}" if m.get("measure_end") else "")
            who = {"top": " (tenor/lead)", "bottom": " (bari/bass)"}.get(m["scope"], "")
            para(f"{rng}{who}  {m['text']}   [{m['source']['date']}]",
                 COLOUR[(m["tier"], m["status"])],
                 "!" if m["tier"] == "act" else "\u00b7")

    # Things the director has not decided. Collected here rather than mixed into
    # the settled markings, so nobody pencils in something still in flux.
    if tbd:
        y -= 4; rule("direction TBD \u2014 awaiting the director")
        for m in sorted(tbd, key=lambda m: (m["measure"] or 999)):
            loc = (f"m.{m['measure']}" + (f"-{m['measure_end']}" if m.get("measure_end") else "")
                   + "  ") if m["measure"] else ""
            txt = m["text"].lstrip()
            if txt.upper().startswith("OPEN."):
                txt = txt[5:].lstrip()
            para(f"{loc}{txt}   [{m['source']['date']}]", AMBER, "?")

    if dead:
        y -= 4; rule("superseded by a later rehearsal")
        for m in dead:
            para(f"{m['text']}   [{m['source']['date']}, overridden by "
                 f"{m.get('superseded_by')}]", Color(.6, .6, .6), "\u00d7", strike=True)
    c.setFillColorRGB(.6, .6, .6); c.setFont("Helvetica", 7)
    c.drawString(L, 40, "Generated from markings.json. Annotations are rehearsal notes "
                        "added to a licensed copy; the underlying score is unmodified.")
    c.save(); buf.seek(0)
    return PdfReader(buf)


TOP_STAFF = {"tenor", "lead"}
BOTTOM_STAFF = {"baritone", "bass"}


def staff_of(scope):
    """voice_part[] -> which staff to band, or None for the whole system.

    An SSAA chart braces two staves: tenor and lead above, baritone and bass
    below. A marking aimed at parts that all live on one staff bands only that
    staff; anything mixed, or unscoped, bands both.
    """
    parts = {p for p in (scope or []) if p}
    if not parts:
        return None
    if parts <= TOP_STAFF:
        return "top"
    if parts <= BOTTOM_STAFF:
        return "bottom"
    return None


def detect_measure_pt(path):
    """Read this engraving's measure-number size instead of assuming 9.7pt."""
    global MEASURE_FONT_PT
    with pdfplumber.open(path) as pdf:
        measure_pt, _music_pt = profile(pdf.pages)
    if measure_pt:
        MEASURE_FONT_PT = measure_pt
    return MEASURE_FONT_PT


def rehearsal_dates(ids, get):
    """{rehearsal_id: "YYYY-MM-DD"} in chorus-local time.

    Pacific, not UTC: a Wednesday evening rehearsal is already Thursday in UTC,
    which would date every marking a day late and, because supersession is
    ordered by date, could let an older instruction win.
    """
    if not ids:
        return {}
    rows = get("rehearsals", {"select": "id,starts_at",
                              "id": f"in.({','.join(sorted(ids))})"})
    zone = ZoneInfo("America/Los_Angeles")
    return {r["id"]: datetime.fromisoformat(r["starts_at"]).astimezone(zone).date().isoformat()
            for r in rows}


def from_db(song):
    """(meta, already-resolved markings) for one song, straight from Postgres.

    `active_markings` is published-only (`where review_status = 'published'`)
    as well as supersession-resolved, so no status filter is needed here and a
    song whose markings are still draft or approved renders nothing. That is
    the publish contract working, not a bug: the review queue flips approved to
    published, and only then does a marking reach a score.
    """
    base = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (base and key):
        raise SystemExit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
                         "(.env.local), or use --file.")

    def get(path, query):
        url = f"{base}/rest/v1/{path}?{urllib.parse.urlencode(query)}"
        req = urllib.request.Request(url, headers={
            "apikey": key, "authorization": f"Bearer {key}", "accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)

    # songs has no slug column; title is the only handle.
    rows = get("songs", {"select": "id,title", "title": f"ilike.*{song}*"})
    if not rows:
        raise SystemExit(f"No song matching {song!r}.")
    if len(rows) > 1:
        raise SystemExit("That matches more than one song: "
                         + ", ".join(r["title"] for r in rows))
    found = rows[0]

    marks = get("active_markings", {
        "select": "id,rehearsal_id,bar,bar_end,tier,resolution,kind,scope,tag,"
                  "text,topic,supersedes,source",
        "song_id": f"eq.{found['id']}",
        "order": "bar.asc",
    })

    # `markings.source` is an enum recording provenance ("system"), not the
    # prototype's {date, who, file}. A marking's DATE is its rehearsal's date,
    # and supersession is ordered by it, so fetch that separately: PostgREST
    # cannot embed through a view without a declared relationship.
    dates = rehearsal_dates({m["rehearsal_id"] for m in marks if m["rehearsal_id"]}, get)
    # active_markings has already resolved supersession; map its column names
    # onto the ones the drawing code reads.
    markings = [{
        "id": m["id"],
        "measure": m["bar"],
        "measure_end": m["bar_end"],
        "tier": m["tier"] or "note",
        "status": m["resolution"] or "settled",
        "kind": m["kind"],
        "scope": staff_of(m["scope"]),
        "tag": m["tag"],
        "text": m["text"] or "",
        "topic": m["topic"],
        "supersedes": m["supersedes"] or [],
        "source": {"date": dates.get(m["rehearsal_id"], ""),
                   "who": m["source"] or "system"},
    } for m in marks]
    return {"song": found["title"]}, markings


def build(meta, active, dead, src, out):
    dates = sorted({m["source"]["date"] for m in active})
    header = "DIRECTOR MARKINGS  ·  REHEARSALS " + ", ".join(
        d[5:].replace("-", "/") for d in dates)

    reader, writer = PdfReader(src), PdfWriter()
    with pdfplumber.open(src) as pdf:
        # assign each marking to a page
        page_of, geoms, general = {}, {}, []
        for pi, pg in enumerate(pdf.pages, 1):
            geoms[pi] = page_geom(pg)
        for m in active:
            hit = (next((pi for pi in geoms
                         if geoms[pi] and m["measure"] in geoms[pi]["mn"]), None)
                   if m["measure"] is not None else None)
            # Song-wide guidance has no bar to sit on, and page 1 has no room
            # beneath the copyright block. It goes on the appended summary.
            (page_of.setdefault(hit, []).append(m) if hit else general.append(m))

        for pi, pg in enumerate(pdf.pages, 1):
            page, marks, g = reader.pages[pi - 1], page_of.get(pi), geoms[pi]
            if not marks or not g:
                writer.add_page(page); continue
            H, W = g["H"], g["W"]
            onscore = marks
            onscore.sort(key=lambda m: (g["mn"][m["measure"]][1], g["mn"][m["measure"]][0]))
            marks = onscore
            buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=(W, H))

            def badge(x, y, lab, col, r=5.2, hollow=False):
                if len(lab) > 2:
                    w = stringWidth(lab, "Helvetica-Bold", r * 1.27) + r * 1.5
                    c.setFillColorRGB(1, 1, 1) if hollow else c.setFillColor(col)
                    c.setStrokeColor(col); c.setLineWidth(1.0)
                    c.roundRect(x - w / 2, y - r, w, r * 2, r, stroke=1, fill=1)
                    c.setFillColor(col) if hollow else c.setFillColorRGB(1, 1, 1)
                    c.setFont("Helvetica-Bold", r * 1.27)
                    c.drawCentredString(x, y - r * 0.44, lab)
                    return
                if hollow:
                    c.setFillColorRGB(1, 1, 1); c.setStrokeColor(col); c.setLineWidth(1.0)
                    c.circle(x, y, r, stroke=1, fill=1); c.setFillColor(col)
                else:
                    c.setFillColor(col); c.circle(x, y, r, stroke=0, fill=1)
                    c.setFillColorRGB(1, 1, 1)
                c.setFont("Helvetica-Bold", r * 1.27); c.drawCentredString(x, y - r * 0.44, lab)

            # reserve the inter-system gaps: a tag row below, a bracket row above
            nsys = len(g["systems"])
            brk = {sys_of(g, g["mn"][m["measure"]][1]) for m in onscore if m.get("measure_end")}
            tagd = {sys_of(g, g["mn"][m["measure"]][1]) for m in onscore if not m.get("measure_end")}
            TAGY, BRKY = {}, {}
            for si in range(nsys):
                pb = ink_bottom(g, si)
                nt = ink_top(g, si + 1) if si + 1 < nsys else H - 60
                gap = max(nt - pb, 14)
                TAGY[si] = pb + (gap * 0.34 if (si + 1) in brk else 9)
                if si in brk:
                    prev = ink_bottom(g, si - 1) if si else 0
                    gp = max(ink_top(g, si) - prev, 14)
                    BRKY[si] = ink_top(g, si) - (gp * 0.30 if si and (si - 1) in tagd else 11)
                    BRKY[si] = max(BRKY[si], g["systems"][si][0][0] - 26)

            legend = []
            for i, m in enumerate(marks):
                m["_lab"] = str(i + 1)
                legend.append((m["_lab"], COLOUR[(m["tier"], m["status"])], m))

            # Several instructions can land on one bar. Group by (bar, span,
            # scope) so the bar gets ONE band and ONE badge; the legend still
            # lists each instruction separately and the badge shows the range.
            groups = []
            for m in marks:
                key = (m["measure"], m.get("measure_end"), m["scope"])
                if groups and groups[-1][0] == key:
                    groups[-1][1].append(m)
                else:
                    groups.append((key, [m]))

            drawn = []         # text rects already placed, to avoid overprint
            def place(x, y, w, h=7.0, up=True):
                """Nudge a label off anything already drawn in the same gap."""
                for _ in range(8):
                    if not any(x < rx + rw and x + w > rx and
                               abs(y - ry) < (h + rh) / 2
                               for rx, ry, rw, rh in drawn):
                        break
                    y += h + 1.5 if up else -(h + 1.5)
                drawn.append((x, y, w, h))
                return y

            colour_key(c, g, H, drawn)
            used = []          # badge anchors already drawn on this page
            def free_slot(x, y):
                """Same bar, different scope draws two groups. Nudge the second
                badge up so it is not hidden under the first."""
                while any(abs(x - ux) < 7 and abs(y - uy) < 9 for ux, uy in used):
                    y += 11
                used.append((x, y))
                return y

            for _k, grp in groups:
                m = next((x for x in grp if x["tier"] == "act"), grp[0])
                st = "open" if any(x["status"] == "open" for x in grp) else m["status"]
                col = COLOUR[(m["tier"], st)]
                lab = (grp[0]["_lab"] if len(grp) == 1
                       else f'{grp[0]["_lab"]}-{grp[-1]["_lab"]}')
                tagtxt = " \u00b7 ".join([x["tag"] for x in grp if x.get("tag")])
                hollow = all(x["tier"] == "note" for x in grp)
                x0, x1, si = span_x(g, m["measure"])
                nx, ntop, nbot = g["mn"][m["measure"]]

                if m.get("measure_end") and m["measure_end"] in g["mn"]:
                    end = m["measure_end"] if m["tier"] == "note" else m["measure_end"] - 1
                    _, ex, esi = span_x(g, end)
                    if m["tier"] == "note":
                        ex = span_x(g, m["measure_end"])[1]
                    c.setStrokeColor(col); c.setFillColor(col); c.setLineWidth(1.2)
                    for j, s2 in enumerate(range(si, esi + 1)):
                        aa = x0 if s2 == si else g["LEFT"]
                        bb = ex if s2 == esi else g["RIGHT"]
                        y = H - BRKY.get(s2, ink_top(g, s2) - 11)
                        c.line(aa, y, bb, y); c.line(aa, y, aa, y - 4.5)
                        if s2 == esi: c.line(bb, y, bb, y - 4.5)
                        c.setFont("Helvetica-Bold", 6.3)
                        lt = tagtxt if j == 0 else "\u2026 cont."
                        c.drawString(aa + 9, place(aa + 9, y + 3,
                                     stringWidth(lt, "Helvetica-Bold", 6.3), up=False), lt)
                    badge(x0 - 9, free_slot(x0 - 9,
                          H - BRKY.get(si, ink_top(g, si) - 11) + 0.5), lab, col)
                    continue

                yt, yb = band_y(g, si, m["scope"])
                if m["tier"] == "act":
                    c.setFillColor(tint(col, 0.11))
                    c.roundRect(x0, H - yb, x1 - x0, yb - yt, 3, stroke=0, fill=1)
                    c.setStrokeColor(tint(col, 0.6)); c.setLineWidth(1.2)
                    c.line(x0, H - yt, x0, H - yb)
                else:
                    c.setStrokeColor(tint(col, 0.5)); c.setLineWidth(1.0)
                    c.setDash(2, 2); c.line(x0, H - yt, x0, H - yb); c.setDash()
                bx = nx - (11 if len(lab) > 2 else 9)
                badge(bx, free_slot(bx, H - (ntop + nbot) / 2), lab, col, hollow=hollow)
                if not tagtxt:
                    continue
                c.setFillColor(col); c.setFont("Helvetica-Bold", 6.3)
                tw = stringWidth(tagtxt, "Helvetica-Bold", 6.3)
                nxr = min([v[0] for v in g["mn"].values()
                           if v[0] > nx + 6 and abs(v[1] - ntop) < 22] or [g["RIGHT"]])
                ix = nx + stringWidth(str(m["measure"]), "Helvetica", MEASURE_FONT_PT) + 6
                if (hollow and ix + tw < nxr - 6
                        and free_rect(g, ix, ix + tw, ntop - 3, nbot + 3)):
                    c.drawString(ix, H - nbot, tagtxt)
                else:
                    c.drawString(x0 + 3, place(x0 + 3, H - TAGY[si], tw, up=False), tagtxt)

            # legend, auto-fitted to whatever room the page actually has
            avail = g["footer_top"] - 6 - (g["body_bottom"] + 14)
            def wrap(t, w, fs):
                out_, line = [], ""
                for word in t.split():
                    tr = (line + " " + word).strip()
                    if stringWidth(tr, "Helvetica", fs) <= w: line = tr
                    else: out_.append(line); line = word
                if line: out_.append(line)
                return out_
            def entry(m):
                d = m["source"]["date"][5:].replace("-", "/")
                return f"{'m.' + str(m['measure']) + ('-' + str(m['measure_end']) if m.get('measure_end') else '') + '  ' if m['measure'] else ''}{m['text']}  [{d}]"
            def layout(fs, nc):
                cw = (g["RIGHT"] - g["LEFT"] - 18 * (nc - 1)) / nc
                per = (len(legend) + nc - 1) // nc
                lead, gp = fs * 1.18, fs * 0.64
                hs = [sum(lead * len(wrap(entry(m), cw - 14, fs)) + gp
                          for _, _, m in legend[ci * per:(ci + 1) * per]) for ci in range(nc)]
                return cw, per, lead, gp, (max(hs) if hs else 0) + 12
            for fs, nc in [(6.6, 2), (6.2, 2), (6.6, 3), (6.2, 3), (5.8, 3), (5.4, 3), (5.0, 3), (4.6, 3)]:
                cw, per, lead, gp, need = layout(fs, nc)
                if need <= avail: break
            spilled = 0
            if avail < 34:                    # no usable band on this page
                spilled, legend = len(legend), []
            else:
                while need > avail and len(legend) > 1:
                    legend = legend[:-1]; spilled += 1
                    cw, per, lead, gp, need = layout(fs, nc)
            ly = H - (g["body_bottom"] + 16)
            c.setFillColorRGB(.42, .42, .42); c.setFont("Helvetica-Bold", min(fs, 6.6))
            c.drawString(g["LEFT"], ly, header)
            c.setStrokeColorRGB(.72, .72, .72); c.setLineWidth(.5)
            c.line(g["LEFT"], ly - 4, g["RIGHT"], ly - 4)
            cy = [ly - 13] * nc
            for i, (lab, col, m) in enumerate(legend):
                ci = min(i // per, nc - 1)
                x = g["LEFT"] + ci * (cw + 18)
                lines = wrap(entry(m), cw - 14, fs)
                badge(x + 4.5, cy[ci] + 1.2, lab, col, r=fs * 0.7, hollow=(m["tier"] == "note"))
                c.setFillColorRGB(.13, .13, .13); c.setFont("Helvetica", fs)
                for j, ln in enumerate(lines):
                    c.drawString(x + 12, cy[ci] - j * lead, ln)
                cy[ci] -= lead * len(lines) + gp
            c.save(); buf.seek(0)
            page.merge_page(PdfReader(buf).pages[0])
            writer.add_page(page)

    _sum = summary_page(meta, active, dead, general, W=612, H=792)
    for sp in _sum.pages:
        writer.add_page(sp)
    with open(out, "wb") as f:
        writer.write(f)
    print(f"wrote {out}")
    print(f"  active {len(active)}, superseded {len(dead)}")
    for m in dead:
        print(f"  SUPERSEDED {m['id']} ({m['source']['date']}, {m['topic']}) "
              f"-> {m.get('superseded_by')}")
    for pi in sorted(page_of):
        print(f"  p{pi}: " + ", ".join(
            ("m." + str(x["measure"]) if x["measure"] else "general") for x in page_of[pi]))
    return out


def load_env():
    """Read .env.local the way import.mjs does, so both tools take one setup."""
    # Walk up from this file to the repo root, so the script works whether it
    # is run from the root (as the README does) or from its own directory.
    roots = [os.getcwd()] + [str(d) for d in pathlib.Path(__file__).resolve().parents]
    for directory, name in ((d, n) for d in roots for n in (".env.local", ".env")):
        path = os.path.join(directory, name)
        if not os.path.exists(path):
            continue
        for line in open(path):
            match = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)", line)
            if match and not os.environ.get(match.group(1)):
                os.environ[match.group(1)] = match.group(2).strip().strip("\"'")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Render a song's markings onto its score.")
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--song", help="slug or title; reads active_markings from Postgres")
    source.add_argument("--file", help="a markings.json, for working without a database")
    ap.add_argument("--score", required=True, help="the score PDF to annotate")
    ap.add_argument("--out", default="annotated.pdf")
    args = ap.parse_args()

    if args.song:
        load_env()
        meta, active = from_db(args.song)
        dead = []          # active_markings already dropped the superseded ones
    else:
        meta = json.load(open(args.file))
        active, dead = resolve(meta["markings"])

    if not active:
        raise SystemExit("No published markings for that song, so there is nothing "
                         "to draw. Approve them in the review queue and publish.")

    pt = detect_measure_pt(args.score)
    print(f"{meta['song']}: {len(active)} marking(s), measure numbers at {pt}pt")
    build(meta, active, dead, args.score, args.out)
