#!/usr/bin/env python3
"""Stage 4c — find where a phrase is sung.

    python3 lyric_match.py <score_lyrics.json> "<phrase>"

The consumer of `score_lyrics.py`, and the thing that turns a lyric into a bar
number. Three callers (HANDOFF §3 and §5):

  * confirming which song a rehearsal block is, by matching what the chorus
    sang against each score in the repertoire;
  * resolving a marking a coach anchored to words instead of a measure —
    `needs_measure: true` plus an anchor, cleared to a real `measure` here;
  * decoding ASR garble — within limits, measured below.

**Matching runs on letters only.** The page is stripped to a single lowercase
letter stream and searched there, which makes every engraving artefact
disappear at once: syllable hyphenation ("Cru - el - la"), pdfplumber merging
tight pairs into "whenshe's", and punctuation an engraver hangs off a note.
`normalise` doing this is also why `join_syllables` never has to be perfect.

Exact search comes first. When it misses — a dropped ligature glyph, or a
mishearing — the same stream is rescanned with a similarity ratio over windows
the length of the needle, so a phrase survives a few wrong letters.

**How much garble survives, measured against Cruella's score.** "cruel a de
vil" scores 0.91 and "crew Ella Devil" 0.85, so both resolve. The prototype's
own worst example does not: "relative ill" peaks at **0.64**, and that is its
best window anywhere in the score — the same range coincidence lives in, so no
floor admits it without admitting noise. Severe garble is not a string-distance
problem and must not be forced into one. It is recovered instead by identifying
the *block* (`identify_songs.py`), which scores that stretch of the real
rehearsal at 0.11–0.19 for Cruella against 0.00–0.01 for everything else: once
the song is known, a repeated unmatched phrase is its hook line.
"""
import json
import re
import sys
from difflib import SequenceMatcher

from score_lyrics import normalise

FUZZY_FLOOR = 0.72     # below this a "match" is coincidence, not a mishearing
FUZZY_STEP = 4         # letters between window starts on the fuzzy rescan
MIN_PHRASE = 3
FUZZY_MARGIN = 0.05   # how far a fuzzy hit must lead to count as the answer


def build_index(lyrics):
    """(letter stream, [(offset, line)]) — the stream every search runs against."""
    stream, spans = [], []
    for line in lyrics["lines"]:
        letters = normalise(line["text"])
        if not letters:
            continue
        spans.append((sum(len(s) for s in stream), line))
        stream.append(letters)
    return "".join(stream), spans


def _locate(spans, offset):
    """Which line a stream offset fell in."""
    found = None
    for start, line in spans:
        if start <= offset:
            found = line
        else:
            break
    return found


def find(lyrics, phrase, fuzzy=True):
    """Every place `phrase` is sung, best first.

    Each hit carries the bar and page it landed on, the line it matched inside,
    and `score` (1.0 for an exact hit). A caller resolving a marking should
    look at how many hits came back before trusting one: a distinctive line
    returns a single hit, and a word like "world" returns several, which is
    ambiguity to surface rather than a bar to silently pick.
    """
    needle = normalise(phrase)
    if len(needle) < MIN_PHRASE:
        return []
    stream, spans = build_index(lyrics)
    if not stream:
        return []

    hits = []
    for m in re.finditer(f"(?={re.escape(needle)})", stream):
        line = _locate(spans, m.start())
        if line:
            hits.append({"bar": line["bar"], "page": line["page"],
                         "line": line["text"], "score": 1.0, "exact": True})
    if hits or not fuzzy:
        return hits

    width = len(needle)
    best = {}
    for start in range(0, max(1, len(stream) - width + 1), FUZZY_STEP):
        window = stream[start:start + width]
        ratio = SequenceMatcher(None, needle, window).ratio()
        if ratio < FUZZY_FLOOR:
            continue
        line = _locate(spans, start)
        if not line:
            continue
        key = (line["page"], line["bar"], line["text"])
        if ratio > best.get(key, {"score": 0})["score"]:
            best[key] = {"bar": line["bar"], "page": line["page"],
                         "line": line["text"], "score": round(ratio, 3), "exact": False}
    return sorted(best.values(), key=lambda h: -h["score"])


# Single quotes as well as double, because that is how the anchors actually
# arrive: "Quick cutoff on 'quicker'", "Slide on 'expensive'". Restricting
# this to double quotes lost every one of them.
#
# The apostrophe is the whole difficulty, and position settles it: an opening
# quote is never preceded by a letter and a closing one is never followed by
# one. That keeps `Cruella's transition on "first"` anchored on "first"
# instead of on "s transition on", and leaves "don't" alone.
# 80, not 40: a director quotes a whole sung line, not a word. "What makes a
# monster and what makes a man" is 41 characters and a 40-char cap missed it
# by one, leaving the marking unplaced when the score has that lyric at m.198.
QUOTED = re.compile(
    r"(?<![A-Za-z])['\u2018\"\u201c]([^'\u2019\"\u201d]{3,80})['\u2019\"\u201d](?![A-Za-z])")


def quoted_anchors(text):
    """The lyrics a human quoted inside a prose note.

    Choreography and coaching notes rarely carry a separate `anchor` field —
    they say `transition on "first"` or `to "nyaaa"` in the prose. Those quotes
    are the anchor, and are what makes an otherwise unplaceable note resolvable.
    """
    return [q.strip() for q in QUOTED.findall(text or "") if normalise(q)]


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    lyrics = json.load(open(sys.argv[1]))
    phrase = " ".join(sys.argv[2:])
    results = find(lyrics, phrase)
    if not results:
        print(f"no match for {phrase!r}")
        raise SystemExit(1)
    kind = "exact" if results[0]["exact"] else "fuzzy"
    print(f"{len(results)} {kind} match(es) for {phrase!r}")
    for hit in results[:8]:
        print(f"  p{hit['page']} m.{hit['bar']}  ({hit['score']})  {hit['line'][:64]}")


def resolve(lyrics, text, prefer=None):
    """(bar, note) for a marking that names its lyric but not its measure.

    Coaches anchor by ear: "quick cutoff on 'quicker'", "slide on
    'expensive'". The words are in the score's lyric layer, so the bar is
    recoverable — this is the resolution pass HANDOFF §5 asks for.

    A lyric that recurs cannot be resolved by itself, and guessing is the one
    thing not to do: a wrong bar gets drawn on the page and somebody pencils
    it in, which is worse than an unplaced note. So a phrase found at several
    bars returns no bar and a `[?]` note naming the candidates, which is the
    convention the markings already use for "a human should check this".

    `prefer` narrows an ambiguous hit to a bar range already known to be in
    play, when the caller has one.
    """
    for phrase in quoted_anchors(text):
        hits = find(lyrics, phrase)
        bars = sorted({h["bar"] for h in hits if h["bar"] is not None})
        if not bars:
            continue
        if len(bars) == 1:
            return bars[0], None
        # Exact hits at several bars are genuinely equal — the lyric recurs,
        # and nothing in the words says which. Fuzzy hits are not: they come
        # ranked, and a clear winner is a real answer rather than a guess.
        # "What makes a monster and what makes a man" only matches loosely
        # because another part sings "do do do" through it in the score, and
        # it scores 0.91 at m.198 against 0.82 at m.195.
        if not hits[0]["exact"]:
            best, runner = hits[0], next((h for h in hits[1:] if h["bar"] != hits[0]["bar"]), None)
            if best["bar"] is not None and (runner is None or best["score"] - runner["score"] >= FUZZY_MARGIN):
                return best["bar"], None
        if prefer:
            inside = [b for b in bars if prefer[0] <= b <= prefer[1]]
            if len(inside) == 1:
                return inside[0], None
        listed = ", ".join(f"m.{b}" for b in bars[:4])
        return None, f"[?] \u201c{phrase}\u201d is sung at {listed} \u2014 confirm which."
    return None, None
