#!/usr/bin/env python3
"""Stage 1b — transcribe the audio ourselves when YouTube has no captions.

    python3 transcribe.py <youtube url> [out.tsv]

`fetch_transcript.py` asks YouTube for its auto-captions, which is free and
takes a second. This is what happens when there are none: the audio is pulled
down and run through Whisper locally.

**It is not only a fallback.** YouTube's auto-captions are poor on this
material — they rendered "Cruella De Vil" as "relative ill", five times over —
and everything downstream reads the transcript. Better words mean better
markings and more bar numbers recovered from quoted lyrics. The captions path
stays first because it is a hundred times faster, not because it is better.

Runs on Apple Silicon through MLX, which uses the GPU. That is also where it
has to run: the captions job is already pinned to the self-hosted Mac because
YouTube blocks datacentre IPs, and the audio download has the same problem.
"""
import json
import os
import subprocess
import sys
import tempfile

# large-v3-turbo is the accuracy of large at a fraction of the time, which is
# the trade that matters for a three-hour rehearsal.
# Measured on an M-series Mac: large-v3-turbo runs at 26x realtime, so a
# 168-minute rehearsal transcribes in about six minutes. That is what makes
# this viable locally and a transcription API unnecessary — an API would still
# need the audio pulled down here first, because YouTube blocks datacentre IPs.
MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")


def download_audio(url, directory):
    """Smallest audio-only stream yt-dlp will give us, as a 16kHz mono wav.

    Whisper resamples to 16kHz mono anyway, so doing it in ffmpeg on the way
    out avoids holding a three-hour stereo file in memory.
    """
    out = os.path.join(directory, "audio.wav")
    # sys.executable -m yt_dlp, not a bare "yt-dlp": the runner installs into
    # a venv whose bin directory is not on PATH, so the console script is not
    # findable even though the package is right there.
    result = subprocess.run(
        [sys.executable, "-m", "yt_dlp", "-f", "bestaudio/best", "--extract-audio",
         "--audio-format", "wav", "--postprocessor-args", "-ar 16000 -ac 1",
         "--extractor-args", "youtube:player_client=android",
         "-o", os.path.join(directory, "audio.%(ext)s"), "--quiet", "--no-warnings", url],
        capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(out):
        raise RuntimeError(
            "Could not download the audio: "
            + (result.stderr or result.stdout or "no output").strip().splitlines()[-1][:200])
    return out


def transcribe(path):
    """[(seconds, text)] — the same shape parse_vtt returns, so callers do not care."""
    try:
        import mlx_whisper
    except ImportError:
        raise RuntimeError(
            "mlx-whisper is not installed. It is Apple-Silicon only and is "
            "installed by a platform marker in requirements.txt, so this runs "
            "on the self-hosted Mac and nowhere else.") from None

    result = mlx_whisper.transcribe(
        path, path_or_hf_repo=MODEL,
        # A rehearsal is one long room recording; without this the model drifts
        # into repeating itself during the long stretches of singing.
        condition_on_previous_text=False,
        verbose=False)
    return [(int(s["start"]), s["text"].strip())
            for s in result.get("segments", []) if s.get("text", "").strip()]


def fetch(url):
    """(title, source_label, segments) — matching fetch_transcript.fetch."""
    with tempfile.TemporaryDirectory() as directory:
        audio = download_audio(url, directory)
        size_mb = os.path.getsize(audio) / 1e6
        print(f"  audio {size_mb:.0f}MB, transcribing with {MODEL.split('/')[-1]}")
        segments = transcribe(audio)
    if not segments:
        raise RuntimeError("Whisper produced no speech at all from that audio.")
    return "Rehearsal", f"whisper ({MODEL.split('/')[-1]})", segments


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    title, source, segments = fetch(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else "transcript.tsv"
    with open(out, "w") as fh:
        fh.write(f"# {title}\n# {sys.argv[1]}\n# seconds\ttext\n")
        for at, text in segments:
            fh.write(f"{at}\t{text}\n")
    print(f"{len(segments)} segments over {segments[-1][0] // 60} min -> {out}")
