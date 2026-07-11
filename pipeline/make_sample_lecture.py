"""
Generates a short sample "lecture" so the video-ingestion path can be
proven end-to-end without Rich needing to supply a real recording.

Produces two files from the same script:
  - sample_lecture.txt  -- the transcript itself, usable directly by
    ingest_video.py (no OpenAI key needed -- see extract_slides_from_video).
  - sample_lecture.m4a  -- an actual short audio file, synthesized with
    macOS's built-in `say` command (free, local, no account) and
    compressed with ffmpeg, ready to run through real Whisper
    transcription the moment an OPENAI_API_KEY is available. At ~40
    seconds of speech this costs a fraction of a cent to transcribe.

Topic: how vaccines work -- picked as a second, distinct sample topic
from the solar-system slide deck, to prove ingestion isn't tied to one
subject.
"""

import subprocess
import sys
from pathlib import Path

SCRIPT = """
Today we're going to talk about how vaccines work. A vaccine trains your immune system to
recognize a specific pathogen, like a virus or bacterium, without making you sick from the
real disease first. Most vaccines contain a weakened or inactivated form of the pathogen, or
just a harmless piece of it, such as a protein from its outer surface.

When that material enters your body, your immune system treats it as a threat and produces
antibodies against it. Some of the immune cells that respond become memory cells, and they
can persist for years or even decades. If you're ever exposed to the real pathogen later,
those memory cells recognize it immediately and mount a much faster, stronger response than
your immune system could manage on its own the first time.

This is why vaccinated people who do get infected typically have much milder symptoms, or no
symptoms at all, compared to someone with no prior immunity. It's also why some vaccines need
multiple doses. The first dose primes the immune system, and a booster dose later strengthens
that memory response and makes it last longer.

Herd immunity is a related idea. When enough people in a population are immune to a disease,
either through vaccination or prior infection, the pathogen has a much harder time spreading,
because it runs out of new hosts to infect. This indirectly protects people who can't be
vaccinated themselves, such as newborns or people with certain medical conditions.
"""


def build(txt_path: str, audio_path: str):
    text = SCRIPT.strip()
    Path(txt_path).write_text(text + "\n")
    print(f"Wrote transcript -> {txt_path}")

    aiff_path = str(Path(audio_path).with_suffix(".aiff"))
    subprocess.run(["say", "-o", aiff_path, text], check=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", aiff_path, "-ar", "16000", "-ac", "1", audio_path],
        check=True,
    )
    Path(aiff_path).unlink()
    size_kb = Path(audio_path).stat().st_size / 1024
    print(f"Wrote audio -> {audio_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    txt_path = sys.argv[1] if len(sys.argv) > 1 else "sample_lecture.txt"
    audio_path = sys.argv[2] if len(sys.argv) > 2 else "sample_lecture.m4a"
    build(txt_path, audio_path)
