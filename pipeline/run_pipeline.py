"""
Orchestrates the full pipeline: pptx -> slides -> concepts -> validated
concepts -> game-ready JSON.

Auto-published concepts become playable encounters immediately. Flagged
concepts are written to a separate review queue file instead of blocking
the rest of the module (Tier 4 in the build plan).

Usage:
  python run_pipeline.py <deck.pptx> [--mock] [--out-dir DIR]

If ANTHROPIC_API_KEY is not set, this automatically falls back to --mock
and prints a note explaining why -- it does not require an account or
payment to run.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from generate_concepts import generate_concepts
from ingest_pptx import extract_slides
from schema import SCHEMA_VERSION, STATUS_AUTO_PUBLISHED, STATUS_FLAGGED
from validate import validate_concepts

# Loads pipeline/.env if present, so ANTHROPIC_API_KEY doesn't need to be
# exported by hand every session. Safe no-op if the file doesn't exist.
load_dotenv(Path(__file__).parent / ".env")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", help="path to a .pptx file")
    parser.add_argument("--mock", action="store_true", help="force mock mode (no API key needed)")
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).parent / "output"),
        help="directory to write slides.json / concepts.json / review_queue.json / game data into",
    )
    args = parser.parse_args()

    mock = args.mock
    if not mock and not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "NOTE: ANTHROPIC_API_KEY is not set, so running in --mock mode automatically. "
            "Mock mode uses rule-based generation (no account or payment needed) so the "
            "pipeline can be proven end-to-end. Set ANTHROPIC_API_KEY and re-run without "
            "--mock for real LLM-generated content.",
            file=sys.stderr,
        )
        mock = True

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Extracting slides from {args.deck} ...")
    slides = extract_slides(args.deck)
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
        "source_deck": os.path.basename(args.deck),
        "generation_mode": "mock" if mock else "real",
        "concepts": auto_published,
    }
    (out_dir / "concepts.json").write_text(json.dumps(game_data, indent=2))

    print(f"\nDone. Game-ready data: {out_dir / 'concepts.json'}")
    if flagged:
        print(f"Review queue ({len(flagged)} items): {out_dir / 'review_queue.json'}")


if __name__ == "__main__":
    main()
