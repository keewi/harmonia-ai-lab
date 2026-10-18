#!/usr/bin/env python3
"""Change a finished rehearsal's date, and re-render its annotated PDFs to match.

    python3 redate.py data/runs/<id> YYYY-MM-DD

The date is not just a label. It is drawn on page 1 ("Annotated from ...
rehearsal"), printed beside every note, and stored on each marking inside the
PDF, where it decides which instruction wins when a later rehearsal says
something different about the same spot. So a new date means re-drawing each
score from the clean copy embedded in it, with this rehearsal's markings
re-dated. No model call: the markings themselves don't change.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run as R  # noqa: E402


def main(directory, new):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", new):
        raise SystemExit("The new date must be YYYY-MM-DD.")
    r = R.Run(directory)
    old = r.meta["date"]
    if new == old:
        return
    result = json.load(open(r.path("result.json")))

    r.meta["date"] = new  # annotate_score stamps and names files from this
    for sc in result["scores"]:
        before = sc["file"]
        score = R.load_score(r, {"key": sc["key"], "name": sc["name"], "file": before})
        mine = [dict(m, source={**m["source"], "date": new})
                for m in score["prior"] if m["source"]["date"] == old]
        score["prior"] = [m for m in score["prior"] if m["source"]["date"] != old]
        score["prior_dates"] = [d for d in score["prior_dates"] if d != old]
        after, dates = R.annotate_score(r, score, mine)
        if os.path.abspath(r.path(after)) != os.path.abspath(r.path(before)):
            os.remove(r.path(before))
        for song in result["songs"]:
            if song.get("annotated") == before:
                song["annotated"] = after
        sc["file"], sc["dates"] = after, dates

    for name, body in (("result.json", result), ("run.json", r.meta)):
        tmp = r.path(name + ".tmp")
        json.dump(body, open(tmp, "w"), indent=2)
        os.replace(tmp, r.path(name))
    print(f"re-dated {old} -> {new}: " + ", ".join(sc["file"] for sc in result["scores"]))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
