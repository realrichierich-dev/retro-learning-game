"""
Orchestrates the full pipeline: source material -> slides -> concepts ->
validated concepts -> game-ready JSON. Source material is either a .pptx
deck or a video/audio lecture recording (or a pre-transcribed .txt, for
testing the video path without Whisper) -- auto-detected by extension.

Auto-published concepts become playable encounters immediately. Flagged
concepts are written to a separate review queue file instead of blocking
the rest of the module (Tier 4 in the build plan).

Usage:
  python run_pipeline.py <deck.pptx | lecture.mp3/mp4/m4a/wav | transcript.txt> [--mock] [--out-dir DIR]

If ANTHROPIC_API_KEY is not set, concept generation/validation automatically
falls back to --mock and prints a note explaining why -- no account or
payment needed for that stage. Whisper transcription of an actual audio/
video file always needs OPENAI_API_KEY (a separate key from Anthropic's);
there's no mock stand-in for real speech-to-text -- see README. Passing a
.txt file (e.g. from make_sample_lecture.py) skips transcription entirely,
so the segmentation/generation/validation chain can still be tested free.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from generate_concepts import generate_concepts
from ingest_pptx import extract_slides as extract_slides_pptx
from ingest_video import extract_slides_from_video
from schema import SCHEMA_VERSION, STATUS_AUTO_PUBLISHED, STATUS_FLAGGED
from validate import validate_concepts

# Loads pipeline/.env if present, so ANTHROPIC_API_KEY/OPENAI_API_KEY don't
# need to be exported by hand every session. Safe no-op if the file doesn't exist.
load_dotenv(Path(__file__).parent / ".env")

VIDEO_EXTENSIONS = {".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".mov", ".txt"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="path to a .pptx deck, a video/audio lecture, or a .txt transcript")
    parser.add_argument("--mock", action="store_true", help="force mock mode (no API key needed)")
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).parent / "output"),
        help="directory to write slides.json / concepts.json / review_queue.json / game data into",
    )
    args = parser.parse_args()

    ext = Path(args.source).suffix.lower()
    is_video = ext in VIDEO_EXTENSIONS

    mock = args.mock
    if not mock and not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "NOTE: ANTHROPIC_API_KEY is not set, so concept generation/validation is running "
            "in --mock mode automatically (rule-based, no account or payment needed). Set "
            "ANTHROPIC_API_KEY and re-run without --mock for real LLM-generated content.",
            file=sys.stderr,
        )
        mock = True

    if is_video and ext != ".txt" and not os.environ.get("OPENAI_API_KEY"):
        print(
            "ERROR: transcribing an actual audio/video file requires OPENAI_API_KEY (a separate "
            "key from Anthropic's -- Whisper is an OpenAI product, not Anthropic). There is no "
            "mock stand-in for real speech-to-text. To test the rest of the pipeline for free "
            "right now, run make_sample_lecture.py and pass the resulting .txt file instead, "
            "which skips transcription entirely. See README.",
            file=sys.stderr,
        )
        sys.exit(1)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if is_video:
        print(f"[1/4] {'Reading transcript from' if ext == '.txt' else 'Transcribing (Whisper) + segmenting'} {args.source} ...")
        slides = extract_slides_from_video(args.source, mock=mock)
    else:
        print(f"[1/4] Extracting slides from {args.source} ...")
        slides = extract_slides_pptx(args.source)
    (out_dir / "slides.json").write_text(json.dumps(slides, indent=2))
    print(f"      {len(slides)} slides extracted.")

    print(f"[2/4] Generating concepts ({'mock' if mock else 'real LLM'} mode) ...")
    concepts = generate_concepts(slides, mock=mock)
    (out_dir / "concepts_raw.json").write_text(json.dumps(concepts, indent=2))
    print(f"      {len(concepts)} concepts generated.")

    print("[3/4] Validating concepts (deterministic + grounding + self-consistency) ...")
    slides_by_index = {s["slide_index"]: s for s in slides}
    validated = validate_concepts(concepts, slides_by_index, mock=mock)

    auto_published = [c for c in validated if c["validation"]["status"] == STATUS_AUTO_PUBLISHED]
    flagged = [c for c in validated if c["validation"]["status"] == STATUS_FLAGGED]
    print(f"      {len(auto_published)} auto-published, {len(flagged)} flagged for review.")

    (out_dir / "review_queue.json").write_text(json.dumps(flagged, indent=2))

    print("[4/4] Writing game-ready data ...")
    game_data = {
        "schema_version": SCHEMA_VERSION,
        "source_deck": os.path.basename(args.source),
        "generation_mode": "mock" if mock else "real",
        "concepts": auto_published,
    }
    (out_dir / "concepts.json").write_text(json.dumps(game_data, indent=2))

    print(f"\nDone. Game-ready data: {out_dir / 'concepts.json'}")
    if flagged:
        print(f"Review queue ({len(flagged)} items): {out_dir / 'review_queue.json'}")


if __name__ == "__main__":
    main()
