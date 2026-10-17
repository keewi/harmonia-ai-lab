# Harmonia AI Lab

A sandbox for the AI half of Harmonia Connect: upload sheet music and a
rehearsal's YouTube link, and get back the director's notes written onto the
score, a summary, and the list of songs worked on.

It runs **on this Mac only**. YouTube blocks caption downloads from cloud
servers, and the pipeline is Python (yt-dlp, pdfplumber, reportlab), so there
is nothing to deploy.

## Run it

```bash
npm install
cp .env.example .env.local   # then add ANTHROPIC_API_KEY and LAB_PASSWORD
npm run dev                  # http://localhost:3010
```

Python: the app uses `.venv/bin/python` (here a symlink to
`~/.harmonia-companion-venv`). For a fresh one: `npm run setup`.

Password: `LAB_PASSWORD` in `.env.local`. It is not in the code, so nobody can
sign in until it is set. Signing in sets a ten-year cookie; changing the
password signs everyone out.

## How it works

```
upload page ──POST /api/runs──▶ data/runs/<id>/run.json + inputs/*.pdf
                                   │ spawns
                                   ▼
                     pipeline/run.py  ──▶ status.json  (polled by the processing page)
                                      ──▶ result.json + out/*.pdf  (the results page)
```

`pipeline/run.py` stages, all writing progress to `status.json`:

1. **Scores.** Read each PDF's title and lyric layer.
2. **Transcript.** YouTube captions, or Whisper on the audio when there are none.
   Cached in `work/transcript.json`, so **Try again** skips it.
3. **Overview.** One Claude call over the whole rehearsal: summary, songs, and
   where each song was worked on.
4. **Extraction.** One Claude call per song, using harmonia-connect's
   `extract_prompt.md`, run in parallel. Markings with a quoted lyric and no
   bar get placed by lyric match.
5. **Annotation.** `annotate.py` (unchanged from harmonia-connect) draws the
   markings. Then the page-1 stamp reads "Annotated from M/D/YYYY rehearsal(s)".

**History rides inside the PDF.** Every annotated PDF embeds the clean score
(`harmonia-source.pdf`) and every marking so far (`harmonia-lab.json`) as
attachments. Uploading one again re-renders from the clean score with old and
new markings together, so dates accumulate on the stamp and a later rehearsal
supersedes an earlier note on the same topic instead of drawing over it. A PDF
stamped by something else gets its stamp dates read, whited out and merged.

## Where to experiment

- `pipeline/extract_prompt.md` is the per-song notes prompt.
- `OVERVIEW_PROMPT` in `pipeline/run.py` is the summary and song-finding prompt.
- `ANTHROPIC_MODEL` in `.env.local` sets the model.
- `data/runs/<id>/` holds everything about one run, including `pipeline.log`.

`data/` is git-ignored: scores are licensed music and transcripts are private.

## Copied from harmonia-connect

`pipeline/{annotate,fetch_transcript,transcribe,score_bars,score_lyrics,lyric_match}.py`,
`extract_prompt.md`, the design tokens, fonts, logos and the pdf.js viewer.
They are copies. Nothing here touches that repo or its Supabase project.
