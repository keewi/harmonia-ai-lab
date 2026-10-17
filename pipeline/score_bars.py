#!/usr/bin/env python3
"""Stage 4a — read a score's bar numbers and landmarks straight off the page.

    python3 score_bars.py <score.pdf> [out.json]

Two facts make annotation possible without optical music recognition
(PROCESS.md stage 4):

  * Measure numbers are real text with coordinates, so "m.158" resolves to an
    exact spot rather than being placed by eye. A positional filter is
    required: some engravers set the page number in the same face and size, so
    a bare "3" would otherwise resolve to page 3's header. Candidates are
    constrained to the music area.
  * Music fonts encode accidentals and fermatas as addressable glyphs, so "the
    key change" and "the fermata" resolve to real bars instead of guesses. This
    is not cosmetic: the prototype placed "no breath into the key change" at
    m.158 when the change is actually at m.162.

**A key change is where the STANDING key signature changes, and nowhere else.**
Hunting for tight clusters of accidentals in the music does not work, and the
failure is not subtle: on Cruella it reported 20 changes in 101 bars against a
true 2. Those false runs are geometrically identical to the true ones — three
flats, stacked, spanning about 90 points — so no filter on a run's own shape
can separate them. Two of Bells' reported changes, m.23 and m.31, mixed sharps
AND flats in one run, which no key signature does.

Worse, the old test could not see a whole class of real changes. A move to a
one-accidental key draws one glyph per staff: two in an SSAA system, under the
three a run needs. That is why Bells' change at m.113 — nought to one sharp,
holding for forty-seven bars — went unreported entirely.

So the signature is read at the head of every system (`staff_signature`) and a
change is emitted only where that reading moves. A candidate run is then used
for one narrow job: saying exactly which bar the new signature was drawn
before, since a per-system reading can only resolve to a system's first bar.
Both are reported, as `bar` and `system_bar`.

**Neither point size nor font name may be hardcoded.** This file used to fix
the measure number at 9.7pt and name the music fonts, which worked for two
scores and returned *zero bars* on the third: Cruella sets measure numbers at
6.8pt and subsets every face to `font000000002e737fb1`, so there is no name to
match on. Both are now detected per document — the measure size from the
numerals inside the music area, the music face from the glyph-sized layer
(HANDOFF §4: "identify music glyphs by point size instead").

Output feeds `score_bars` (one row per bar), a `key_map` of what signature is
in force from which bar, and the landmark list the extraction pass uses to
resolve phrases like "the key change".

Checked against the three real scores. Cruella now reads 1 flat, 6 flats from
m.45, 5 flats from m.71 — the reading the prototype reached by hand and
recorded as "confirmed by standing signature on every system". Bells keeps
m.162, the one change a human verified in the score.

Cruella's second change is reported at **m.69, not the prototype's m.71, and
this was checked by rendering the page and looking at it.** Page 6, system 2
carries a double barline at x=195/201, then a natural cancelling the sixth
flat, then the new five flats at x=218-232, and then m.69. The engraving
confirms it twice over: each measure number sits a fixed gap right of its own
barline *plus* whatever is printed between, and that gap is 55pt for m.68
(clef and standing signature), 34pt for m.69 (the new signature), and 14pt for
m.70 (nothing). m.71 is simply the first bar of the next system, which is all
a per-system reading can ever resolve — hence `system_bar` alongside `bar`.

Adapted from docs/handoff/rehearsal-companion/lib/score_features.py, which
carries the layout fixes found by rendering and looking — keep it that way.
"""
import json
import re
import sys
from collections import Counter, defaultdict

import pdfplumber

MEASURE_FONT_TOLERANCE = 0.2
MUSIC_MIN_PT = 15       # noteheads and clefs are set far larger than any text
MIN_MEASURE_NUMBERS = 8  # fewer than this is a time signature, not a bar count

# Named engravers, kept as a fast path. Finale/Maestro encodes accidentals and
# fermatas as ASCII; MuseScore/Dorico use Bravura with real SMuFL codepoints.
# A subsetted face matches neither, so size is the fallback.
MUSIC_FONTS = ("MaestroWide", "Bravura")
ACC = {"#": "sharp", "b": "flat", "n": "natural",
       "": "sharp", "": "flat", "": "natural"}
FERMATA = {"U": "above", "u": "below",
           "": "above", "": "below"}

KEY_RUN_MIN = 3          # >=3 tightly spaced accidentals = a candidate signature
KEY_RUN_X_TOLERANCE = 9  # ...within this many points of each other
MARGIN_SLACK = 55        # a run this close to the left edge is the standing key sig

SIG_WINDOW_PT = 70       # how far past the staff's left edge the signature can reach
SIG_GAP_PT = 10          # a wider gap than this ends the signature cluster
MIN_SIG_SYSTEMS = 2      # a signature seen on one system only is a stray accidental


def staff_lines(page):
    """The long horizontal rules that make up the staves."""
    return [l for l in page.lines
            if abs(l["y0"] - l["y1"]) < 0.6 and (l["x1"] - l["x0"]) > 200]


def _ascending(values):
    """How much of this sequence counts up by one — the measure-number signature."""
    if len(values) < 2:
        return 0.0
    return sum(1 for a, b in zip(values, values[1:]) if b == a + 1) / (len(values) - 1)


def profile(pages):
    """(measure_pt, music_pt) — detected, because engravers disagree.

    Counting numerals is not enough to find the measure numbers: Cruella sets
    154 digits in its lyric layer (triplet marks, every one a "3") against 101
    real measure numbers, so the lyric size wins on volume. What actually
    identifies measure numbers is that they **count up** — read in page order
    they score 100% ascending there and 0% for the triplets, 64% against 21%
    for the next-best candidate in Bells. Music glyphs are the most numerous
    character layer set above MUSIC_MIN_PT.
    """
    numerals, glyphs = defaultdict(list), Counter()
    for page in pages:
        rules = staff_lines(page)
        if not rules:
            continue
        top = min(l["top"] for l in rules)
        bottom = max(l["top"] for l in rules)
        candidates = [w for w in page.extract_words(extra_attrs=["size"])
                      if re.fullmatch(r"\d{1,3}", w["text"].strip())
                      and top - 40 <= w["top"] <= bottom + 40]
        for word in sorted(candidates, key=lambda w: (round(w["top"]), w["x0"])):
            numerals[round(word["size"], 1)].append(int(word["text"]))
        for char in page.chars:
            if char["size"] >= MUSIC_MIN_PT:
                glyphs[round(char["size"], 1)] += 1

    ranked = [(size, values) for size, values in numerals.items()
              if len(values) >= MIN_MEASURE_NUMBERS]
    measure_pt = max(ranked, key=lambda kv: (_ascending(kv[1]), len(kv[1])))[0] if ranked else None
    return measure_pt, (glyphs.most_common(1)[0][0] if glyphs else None)


def is_music_char(char, music_pt):
    if any(char["fontname"].endswith(f) for f in MUSIC_FONTS):
        return True
    return music_pt is not None and abs(char["size"] - music_pt) < MEASURE_FONT_TOLERANCE


def geom(page, measure_pt=None):
    """Staff geometry, systems, and every measure number with its coordinates."""
    horizontals = staff_lines(page)
    if not horizontals:
        return None
    if measure_pt is None:
        measure_pt, _ = profile([page])
    if measure_pt is None:
        return None

    ys = sorted({round(l["top"], 1) for l in horizontals})
    staves, current = [], [ys[0]]
    for y in ys[1:]:
        if y - current[-1] <= 12:
            current.append(y)
        else:
            staves.append(current)
            current = [y]
    staves.append(current)
    staves = [(s[0], s[-1]) for s in staves if len(s) >= 4]

    top_staff = min(l["top"] for l in horizontals)
    bottom_staff = max(l["top"] for l in horizontals)

    bars = {}
    for word in page.extract_words(extra_attrs=["size"]):
        text = word["text"].strip()
        in_music_area = top_staff - 40 <= word["top"] <= bottom_staff + 40
        if (re.fullmatch(r"\d{1,3}", text)
                and abs(word["size"] - measure_pt) < MEASURE_FONT_TOLERANCE
                and in_music_area):
            bars.setdefault(int(text), (word["x0"], word["top"]))

    return {
        "left": min(l["x0"] for l in horizontals),
        # An SSAA score braces two staves per system.
        "systems": [(staves[i][0], staves[i + 1][1]) for i in range(0, len(staves) - 1, 2)],
        "bars": bars,
    }


def staff_signature(chars, left):
    """(count, kind) of the standing key signature on one staff.

    The signature is the compact cluster of accidentals just after the clef, so
    it is read by walking right from the staff's left edge and stopping at the
    first real gap. Taking everything within a fixed margin instead picks up
    the first chromatic note of the music and makes the reading flap.
    """
    accidentals = sorted([c for c in chars if c["text"] in ACC
                          and c["x0"] <= left + SIG_WINDOW_PT],
                         key=lambda c: c["x0"])
    if not accidentals:
        return (0, "none")
    cluster = [accidentals[0]]
    for char in accidentals[1:]:
        if char["x0"] - cluster[-1]["x0"] > SIG_GAP_PT:
            break
        cluster.append(char)
    kinds = Counter(ACC[c["text"]] for c in cluster)
    return (len(cluster), kinds.most_common(1)[0][0])


def system_signature(g, system_index, music_chars):
    """The standing signature of a system, read from each of its staves."""
    top, bottom = g["systems"][system_index]
    middle = (top + bottom) / 2
    mine = [c for c in music_chars if which_system(g, c["top"]) == system_index]
    readings = [staff_signature([c for c in mine if lo <= c["top"] < hi], g["left"])
                for lo, hi in ((top - 20, middle), (middle, bottom + 20))]
    return Counter(readings).most_common(1)[0][0]


def denoise(signatures):
    """Drop a signature that holds for fewer than MIN_SIG_SYSTEMS systems.

    Bells reads 0 accidentals for thirty systems with isolated one-system
    blips of "1 flat" and "1 sharp" where a cautionary accidental sits close
    enough to the clef to be swept up. A real key lasts longer than a system.
    """
    out = list(signatures)
    i = 0
    while i < len(out):
        j = i
        while j < len(out) and out[j][1] == out[i][1]:
            j += 1
        if j - i < MIN_SIG_SYSTEMS and i > 0:
            for k in range(i, j):
                out[k] = (out[k][0], out[i - 1][1])
        i = j
    return out


def which_system(g, y):
    for i, (a, b) in enumerate(g["systems"]):
        if a - 32 <= y <= b + 32:
            return i
    return None


def bar_at(g, x, y):
    """Nearest bar number to the LEFT, within the same system."""
    system = which_system(g, y)
    candidates = [(bar, bx) for bar, (bx, by) in g["bars"].items()
                  if which_system(g, by) == system and bx <= x + 10]
    return max(candidates, key=lambda t: t[1])[0] if candidates else None


def extract(path):
    bar_map, fermatas = [], []
    systems = []        # one entry per system, in reading order
    runs_by_system = {}  # (page, system) -> [(bar, kind, size)] candidate signature runs

    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        measure_pt, music_pt = profile(pdf.pages)
        for page_no, page in enumerate(pdf.pages, 1):
            g = geom(page, measure_pt)
            if not g:
                continue

            for bar, (x, y) in sorted(g["bars"].items()):
                bar_map.append({"bar": bar, "page": page_no, "x": round(x, 2), "y": round(y, 2)})

            music_chars = [c for c in page.chars if is_music_char(c, music_pt)]

            for c in sorted(music_chars, key=lambda c: (c["top"], c["x0"])):
                if c["text"] in FERMATA:
                    fermatas.append({"page": page_no,
                                     "bar": bar_at(g, c["x0"], c["top"]),
                                     "placement": FERMATA[c["text"]]})

            for index in range(len(g["systems"])):
                first = min((bar for bar, (bx, by) in g["bars"].items()
                             if which_system(g, by) == index), default=None)
                if first is None:
                    continue
                systems.append(((page_no, index), first,
                                system_signature(g, index, music_chars)))

            accidentals = sorted(
                [c for c in music_chars if c["text"] in ACC],
                key=lambda c: (which_system(g, c["top"]) if which_system(g, c["top"]) is not None else 99, c["x0"]),
            )
            runs, current = [], []
            for c in accidentals:
                same_run = (current
                            and abs(c["x0"] - current[-1]["x0"]) <= KEY_RUN_X_TOLERANCE
                            and which_system(g, c["top"]) == which_system(g, current[-1]["top"]))
                if same_run:
                    current.append(c)
                else:
                    if len(current) >= KEY_RUN_MIN:
                        runs.append(current)
                    current = [c]
            if len(current) >= KEY_RUN_MIN:
                runs.append(current)

            for run in runs:
                x0 = min(c["x0"] for c in run)
                if x0 <= g["left"] + MARGIN_SLACK:
                    continue                      # standing key signature, not a change
                top = min(c["top"] for c in run)
                drawn_after = bar_at(g, x0, top)
                if drawn_after is None:
                    continue
                key = (page_no, which_system(g, top))
                kinds = Counter(ACC[c["text"]] for c in run)
                runs_by_system.setdefault(key, []).append(
                    (drawn_after + 1, kinds.most_common(1)[0][0], len(run)))

    # A key change is where the STANDING signature changes, and nowhere else.
    # The runs only say where to draw the line once a change is known to exist.
    signatures = denoise([(first, sig) for _key, first, sig in systems])
    key_changes = []
    for i in range(1, len(systems)):
        before, after = signatures[i - 1][1], signatures[i][1]
        if before == after:
            continue
        first_bar = signatures[i][0]
        # A mid-system change is drawn in the PREVIOUS system, after its start.
        # Prefer a run there whose accidental matches the key being moved into —
        # except when moving to a key with no accidentals, which is written as
        # naturals cancelling the old signature, never as nothing at all.
        wanted = after[1] if after[0] else "natural"
        candidates = [bar for bar, kind, _size in runs_by_system.get(systems[i - 1][0], [])
                      if kind == wanted and signatures[i - 1][0] < bar <= first_bar]
        key_changes.append({
            "page": systems[i][0][0],
            # Where the new signature is actually drawn, when that is visible.
            "bar": min(candidates) if candidates else first_bar,
            # Where the new signature is first STANDING, which is all a
            # per-system reading can resolve. The two differ by a bar or two
            # whenever the change is drawn mid-system.
            "system_bar": first_bar,
            "from": f"{before[0]} {before[1]}", "to": f"{after[0]} {after[1]}",
            "accidental": after[1],
            "located_by": "signature drawn mid-system" if candidates else "first bar of system",
        })

    refined = {k["system_bar"]: k["bar"] for k in key_changes}
    key_map = [{"from_bar": refined.get(signatures[i][0], signatures[i][0]),
                "signature": f"{sig[0]} {sig[1]}"}
               for i, (_b, sig) in enumerate(signatures)
               if i == 0 or signatures[i - 1][1] != sig]

    bar_map.sort(key=lambda b: b["bar"])
    fermatas = sorted([f for f in fermatas if f["bar"] is not None], key=lambda f: f["bar"])
    key_changes.sort(key=lambda k: k["bar"])
    return {"pages": page_count,
            "engraving": {"measure_pt": measure_pt, "music_pt": music_pt},
            "bars": bar_map,
            "key_map": key_map,
            "landmarks": {"key_changes": key_changes, "fermatas": fermatas}}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "score_bars.json"
    result = extract(src)
    json.dump(result, open(out, "w"), indent=2)

    bars = result["bars"]
    eng = result["engraving"]
    print(f"  engraving: measure numbers {eng['measure_pt']}pt, music glyphs {eng['music_pt']}pt")
    print(f"{result['pages']} pages, {len(bars)} bar numbers"
          + (f" (m.{bars[0]['bar']}–{bars[-1]['bar']})" if bars else ""))
    key_map_text = " -> ".join("m.{0} {1}".format(k["from_bar"], k["signature"])
                               for k in result["key_map"])
    print("  key map: " + (key_map_text or "none"))
    print(f"  key changes at {[k['bar'] for k in result['landmarks']['key_changes']] or 'none'}")
    print(f"  fermatas at {sorted({f['bar'] for f in result['landmarks']['fermatas']}) or 'none'}")
    if not bars:
        print("  no bar numbers found — this score may not print them at all")
    print(f"wrote {out}")
