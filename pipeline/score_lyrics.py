#!/usr/bin/env python3
"""Stage 4b — read a score's lyric layer and index it by bar.

    python3 score_lyrics.py <score.pdf> [out.json]

HANDOFF §4 puts this level with the measure numbers: "Lyrics are extractable
text too. **This is as important as the measure numbers.**" It pays for itself
three ways:

  * **Song identity.** Segmentation only proposes boundaries; which song a
    block is gets confirmed by matching lyrics against the repertoire, never
    by the running order (HANDOFF §3).
  * **Coached sessions.** A coach works by ear and by lyric and may never say
    a bar number — one 117-minute session had zero. Those markings are stored
    with `anchor` and `needs_measure: true`, and a resolution pass matches the
    anchor against this index to set the bar (HANDOFF §5).
  * **ASR garble.** "relative ill", repeated five times and meaningless, is
    the hook line "Cruella De Vil". The score decodes the transcript.

**Finding the lyrics is the whole problem.** A score's text layer also holds
measure numbers, part labels, expression marks, a title block, a copyright
footer and sometimes a spoken-word preamble. Font names do not separate them:
Bells labels its layer `FinaleLyrics`, Diamonds sets lyrics *and* measure
numbers *and* part labels in one face at three sizes, and Cruella subsets
everything to `font000000002e737fb1`. Two measured signals do separate them:

  * **Volume.** The sung layer dominates. Across the three scores the lyric
    layer holds 629–1259 wordlike tokens; every non-lyric layer holds under a
    third as many. Cruella's second verse (a distinct smaller size) is 29% of
    its first, so the floor sits at 20%.
  * **Spread.** Lyrics run the width of the system; part labels stack at one
    x. Measured, every real lyric layer spans 74–83% of the page and Diamonds'
    part labels span **1%**.

Each gate clears every real case by a wide margin on at least one axis, so a
score that fools one is still caught by the other.
"""
import json
import re
import sys
from collections import defaultdict

import pdfplumber

from score_bars import bar_at, geom, profile  # the same geometry the bar map uses

# A sung token: letters, with the punctuation an engraver hangs off a syllable.
WORDLIKE = re.compile(r"^[A-Za-z][A-Za-z'’]*[,.!?;:]?-?$|^-$")
# A subsetted font with no ToUnicode map emits ligatures as (cid:N) — "fight"
# arrives as "(cid:20)ght". Which letters they stood for is unknowable from the
# file, so they are dropped and counted rather than guessed at.
CID = re.compile(r"\(cid:\d+\)")

MIN_SHARE = 0.20      # of the dominant layer's wordlike tokens
MIN_SPREAD = 0.25     # of page width, left-most to right-most token
MIN_TOKENS = 12


def _layers(pdf):
    """{(font, size): [word]} across the whole document."""
    out = defaultdict(list)
    for page_no, page in enumerate(pdf.pages, 1):
        for word in page.extract_words(extra_attrs=["size", "fontname"]):
            word["page"] = page_no
            out[(word["fontname"].split("+")[-1], round(word["size"], 1))].append(word)
    return out


def _wordlike(words):
    return sum(1 for w in words if WORDLIKE.match(CID.sub("", w["text"])))


def find_lyric_layers(pdf):
    """Which (font, size) groups carry the sung text. See the module docstring."""
    width = float(pdf.pages[0].width)
    scored = {}
    for key, words in _layers(pdf).items():
        if len(words) < MIN_TOKENS:
            continue
        xs = [w["x0"] for w in words]
        scored[key] = {
            "wordlike": _wordlike(words),
            "ratio": _wordlike(words) / len(words),
            "spread": (max(xs) - min(xs)) / width,
            "words": words,
        }
    ranked = sorted(scored.items(), key=lambda kv: -kv[1]["wordlike"])
    if not ranked or not ranked[0][1]["wordlike"]:
        return {}
    dominant = ranked[0][1]["wordlike"]
    return {
        key: s for key, s in ranked
        if s["wordlike"] >= dominant * MIN_SHARE
        and s["spread"] >= MIN_SPREAD
        and s["ratio"] >= 0.5
    }


def join_syllables(words):
    """["Cru", "-", "el", "-", "la,"] -> "Cruella,".

    Only an explicit hyphen joins. An earlier version also joined on a small
    x-gap and turned the spoken preamble "Europe is very old" into one word —
    prose sets tighter than sung syllables do, so the gap says nothing.
    """
    tokens = [(CID.sub("", w["text"]), w) for w in sorted(words, key=lambda w: w["x0"])]
    out, join_next = [], False
    for text, _word in tokens:
        if text in ("-", "–", "—"):
            join_next = bool(out)
            continue
        if not text:
            continue
        if join_next and out:
            out[-1] += text
        else:
            out.append(text)
        join_next = text.endswith("-")
        if join_next:
            out[-1] = out[-1][:-1]
    return " ".join(out)


def normalise(text):
    """Letters only, lowercased.

    This is what matching compares, and it is why syllable joining never has to
    be perfect: "O lim De us" and "Olim Deus" both reduce to "olimdeus".
    """
    return re.sub(r"[^a-z]", "", (text or "").lower())


def extract(path):
    lines, layers, cids = [], set(), 0

    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        measure_pt, _ = profile(pdf.pages)
        chosen = find_lyric_layers(pdf)

        by_page = defaultdict(list)
        for (font, size), stats in chosen.items():
            layers.add(f"{font} {size}pt")
            for word in stats["words"]:
                by_page[word["page"]].append(word)

        for page_no, page in enumerate(pdf.pages, 1):
            words = by_page.get(page_no)
            if not words:
                continue
            g = geom(page, measure_pt)
            cids += sum(len(CID.findall(w["text"])) for w in words)

            rows = defaultdict(list)
            for word in words:
                rows[round(word["top"] / 6)].append(word)

            for row in rows.values():
                text = join_syllables(row)
                if not normalise(text):
                    continue
                left = min(w["x0"] for w in row)
                top = min(w["top"] for w in row)
                lines.append({
                    "page": page_no,
                    "bar": bar_at(g, left, top) if g else None,
                    "text": text,
                })

    lines.sort(key=lambda l: (l["page"], l["bar"] if l["bar"] is not None else 0))
    full = " ".join(l["text"] for l in lines)
    return {
        "pages": page_count,
        "layers": sorted(layers),
        "cid_glyphs": cids,
        "lines": lines,
        "text": full,
        "normalised": normalise(full),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "score_lyrics.json"
    result = extract(src)
    json.dump(result, open(out, "w"), indent=2)

    placed = sum(1 for l in result["lines"] if l["bar"] is not None)
    print(f"{result['pages']} pages · lyric layer: {', '.join(result['layers']) or 'NONE FOUND'}")
    print(f"  {len(result['lines'])} lines, {len(result['normalised'])} letters,"
          f" {placed} lines placed at a bar")
    if result["cid_glyphs"]:
        print(f"  {result['cid_glyphs']} unmapped ligature glyphs dropped (subsetted font)")
    for line in result["lines"][:4]:
        print(f"    m.{line['bar']}: {line['text'][:68]}")
    if not result["lines"]:
        print("  no lyric layer found — check the engraver's text sizes")
    print(f"wrote {out}")
