"""
Video/audio ingestion (Tier 1 extraction + segmentation), the second
source format alongside ingest_pptx.py. Produces the exact same
slides.json shape ingest_pptx.py does, so generate_concepts.py and
validate.py work unchanged regardless of which ingestion path fed them.

Two stages:
  1. transcribe() -- sends the audio/video file to OpenAI's Whisper API
     and gets back a plain transcript. Requires OPENAI_API_KEY (a
     separate key from the Anthropic one used elsewhere in this
     pipeline -- Whisper is not an Anthropic product).
  2. segment_transcript() -- a lecture transcript has no natural slide
     boundaries, so this splits it into topic-sized chunks that can be
     treated as "slides" downstream. Two modes, same pattern as
     generate_concepts.py:
       - mock: fixed-size word-count windows, no LLM call, free.
       - real: one Claude call that segments by topic and gives each
         chunk a short title, closer to what the build plan calls
         "chunking with judgment."

Known limitation: OpenAI's Whisper API caps uploads at 25MB. Longer
lecture recordings need to be split into chunks before transcription;
that chunking isn't implemented here -- documented rather than silently
broken. A ~20-30 minute talk at a modest bitrate typically fits under
25MB; anything longer will raise a clear error from the API.
"""

import json
import math
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

from schema import strip_json_fences

load_dotenv(Path(__file__).parent / ".env")

WHISPER_MODEL = "whisper-1"
SEGMENT_MODEL = "claude-haiku-4-5-20251001"
MOCK_WORDS_PER_SEGMENT = 130


def transcribe(media_path: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Whisper transcription requires a separate OpenAI "
            "account/API key (not the same as the Anthropic key used elsewhere) -- see README."
        )

    import openai  # imported lazily so ingest_pptx-only usage never needs this installed

    client = openai.OpenAI(api_key=api_key)
    size = os.path.getsize(media_path)
    if size > 25 * 1024 * 1024:
        raise RuntimeError(
            f"{media_path} is {size / 1_000_000:.1f}MB, over the Whisper API's 25MB upload "
            "limit. Splitting long recordings into chunks isn't implemented yet -- trim or "
            "compress the file first."
        )

    with open(media_path, "rb") as f:
        response = client.audio.transcriptions.create(model=WHISPER_MODEL, file=f)
    return response.text


def segment_transcript_mock(transcript: str) -> list[dict]:
    """Fixed-size word-count windows, no LLM call, free -- proves the wiring."""
    words = transcript.split()
    chunks = [
        words[i : i + MOCK_WORDS_PER_SEGMENT] for i in range(0, len(words), MOCK_WORDS_PER_SEGMENT)
    ]

    slides = []
    for i, chunk_words in enumerate(chunks):
        chunk_text = " ".join(chunk_words)
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", chunk_text) if s.strip()]
        slides.append(
            {
                "slide_index": i,
                "title": f"Segment {i + 1}",
                "bullets": sentences,
                "notes": "",
            }
        )
    return slides


SEGMENTATION_PROMPT = """You are splitting a raw lecture transcript into topic-sized segments \
for an educational game. Respond with ONLY a JSON array (no markdown fences, no commentary) \
matching this exact shape:

[
  {{"title": "short topic title", "bullets": ["key point copied or lightly summarized from this segment", "..."]}},
  ...
]

Rules:
- Split by topic shift, not by a fixed word count -- use judgment about where one idea ends and the next begins.
- Each segment should have 2-5 bullets capturing the concrete facts/claims made in that part of the transcript.
- Base bullets only on the transcript below -- do not invent outside facts.
- Cover the entire transcript; don't skip sections.

Transcript:
{transcript}
"""


def segment_transcript_real(transcript: str) -> list[dict]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set; run with --mock or export a key.")

    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=SEGMENT_MODEL,
        max_tokens=4000,
        messages=[{"role": "user", "content": SEGMENTATION_PROMPT.format(transcript=transcript)}],
    )
    segments = json.loads(strip_json_fences(response.content[0].text))
    return [
        {"slide_index": i, "title": seg["title"], "bullets": seg["bullets"], "notes": ""}
        for i, seg in enumerate(segments)
    ]


def segment_transcript(transcript: str, mock: bool) -> list[dict]:
    if mock:
        return segment_transcript_mock(transcript)
    return segment_transcript_real(transcript)


def extract_slides_from_video(media_path: str, mock: bool) -> list[dict]:
    """
    Same-shaped entry point as ingest_pptx.extract_slides, for run_pipeline.py.

    A .txt file is treated as an already-transcribed transcript and skips
    the Whisper API call entirely -- this is what lets the segmentation ->
    generation -> validation chain be tested for free, without an OpenAI
    key, using make_sample_lecture.py's output. Any other extension goes
    through real transcription, which always needs OPENAI_API_KEY (there's
    no free/mock stand-in for actual speech-to-text).
    """
    if media_path.lower().endswith(".txt"):
        transcript = Path(media_path).read_text()
    else:
        transcript = transcribe(media_path)
    return segment_transcript(transcript, mock=mock)


def main():
    if len(sys.argv) < 2:
        print("usage: python ingest_video.py <video_or_audio_file> [--mock] [output.json]", file=sys.stderr)
        sys.exit(1)

    mock = "--mock" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--mock"]
    media_path = args[0]
    output_path = args[1] if len(args) > 1 else None

    if media_path.lower().endswith(".txt"):
        print(f"Reading pre-transcribed text from {media_path} (skipping Whisper API) ...", file=sys.stderr)
    else:
        print(f"Transcribing {media_path} via Whisper API ...", file=sys.stderr)

    slides = extract_slides_from_video(media_path, mock=mock)
    output = json.dumps(slides, indent=2)
    if output_path:
        with open(output_path, "w") as f:
            f.write(output)
        print(f"Segmented into {len(slides)} slides -> {output_path}")
    else:
        print(output)


if __name__ == "__main__":
    main()
