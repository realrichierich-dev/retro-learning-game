"""
Tier 2 (LLM generation against a fixed schema).

Turns raw extracted slides into structured concept nodes: a title, tags,
a difficulty guess, a short bit of monster/NPC flavor dialogue, and a
4-option quiz question -- plus a `source_span` that must be an exact
quote from the slide's own text, which is what the grounding check in
validate.py verifies against.

Two modes:
  - mock:  pure rule-based generation, no API key or network needed.
           Exists so the pipeline can be proven end-to-end for free.
  - real:  calls the Anthropic API (Claude) with a structured-JSON prompt.
           Requires ANTHROPIC_API_KEY to be set; raises a clear error if not.

Neither mode needs a paid frontier model -- see the build plan's cost
section. Real mode defaults to a cheap/small model.
"""

import json
import os
import random
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

from schema import strip_json_fences

load_dotenv(Path(__file__).parent / ".env")

MODEL = "claude-haiku-4-5-20251001"


def _clean_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z\-']{3,}", text)


def _pick_source_span(slide: dict) -> str:
    """Pick one verbatim sentence/bullet from the slide to ground the question in."""
    candidates = list(slide["bullets"])
    if slide["notes"]:
        # first sentence of notes is often the richest single fact
        first_sentence = re.split(r"(?<=[.!?])\s+", slide["notes"].strip())[0]
        if first_sentence:
            candidates.append(first_sentence)
    candidates = [c for c in candidates if len(c) > 12]
    if not candidates:
        return slide["title"]
    return random.choice(candidates)


def generate_concept_mock(slide: dict, all_slides: list[dict], concept_id: str) -> dict:
    """
    Rule-based stand-in for the LLM pass. It builds a genuine "which
    statement is true" question: the correct option is a verbatim quote
    from this slide (source_span); the wrong options are verbatim quotes
    pulled from *other* slides, so they're real sentences, not nonsense,
    but not true of this concept.
    """
    source_span = _pick_source_span(slide)

    other_bullets = []
    for s in all_slides:
        if s is slide:
            continue
        other_bullets.extend(b for b in s["bullets"] if len(b) > 12)
    random.shuffle(other_bullets)
    distractors = other_bullets[:3]
    while len(distractors) < 3:
        # not enough real material elsewhere in the deck; pad with a clearly-labeled filler
        distractors.append(f"None of the material about {slide['title']} covers this.")

    options = distractors + [source_span]
    correct_index = len(options) - 1
    order = list(range(4))
    random.shuffle(order)
    shuffled_options = [options[i] for i in order]
    correct_index = shuffled_options.index(source_span)

    words = _clean_words(slide["title"])
    tag = (words[0] if words else slide["title"]).lower()

    return {
        "concept_id": concept_id,
        "title": slide["title"],
        "tags": [tag],
        "difficulty": "medium",
        "dialogue": f"A wild {slide['title']} monster blocks the path, quizzing you about {slide['title']}!",
        "source_span": source_span,
        "question": {
            "prompt": f"Which statement about \"{slide['title']}\" is true?",
            "options": shuffled_options,
            "correct_index": correct_index,
        },
        "_source_slide_index": slide["slide_index"],
        "_generation_mode": "mock",
    }


GENERATION_PROMPT = """You are generating one quiz question for an educational game from a single \
slide's content. Respond with ONLY a JSON object (no markdown fences, no commentary) matching \
this exact shape:

{{
  "title": "short concept title",
  "tags": ["one or two lowercase topic tags"],
  "difficulty": "easy" | "medium" | "hard",
  "dialogue": "one playful sentence framing this as a monster/NPC encounter",
  "source_span": "a VERBATIM quote copied exactly from the slide text below that supports the correct answer",
  "question": {{
    "prompt": "the question text",
    "options": ["four", "answer", "choice", "strings"],
    "correct_index": 0
  }}
}}

Rules:
- source_span MUST be copied character-for-character from the slide text below (a direct substring), not paraphrased.
- Exactly one correct option; the other three must be plausible but wrong, and not simply reworded copies of the correct answer.
- Base the question only on the slide text below -- do not invent outside facts.

Slide title: {title}
Slide bullets:
{bullets}
Speaker notes: {notes}
"""


def generate_concept_real(slide: dict, concept_id: str) -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Run with --mock, or export an API key to use real "
            "LLM generation (this requires an Anthropic account/billing -- see README)."
        )

    import anthropic  # imported lazily so --mock never needs this installed

    client = anthropic.Anthropic(api_key=api_key)
    prompt = GENERATION_PROMPT.format(
        title=slide["title"],
        bullets="\n".join(f"- {b}" for b in slide["bullets"]) or "(none)",
        notes=slide["notes"] or "(none)",
    )
    response = client.messages.create(
        model=MODEL,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    text = strip_json_fences(response.content[0].text)
    data = json.loads(text)
    data["concept_id"] = concept_id
    data["_source_slide_index"] = slide["slide_index"]
    data["_generation_mode"] = "real"
    return data


def generate_concepts(slides: list[dict], mock: bool) -> list[dict]:
    concepts = []
    for i, slide in enumerate(slides):
        concept_id = f"c{i + 1}"
        if mock:
            concepts.append(generate_concept_mock(slide, slides, concept_id))
        else:
            concepts.append(generate_concept_real(slide, concept_id))
    return concepts


def main():
    if len(sys.argv) < 2:
        print("usage: python generate_concepts.py <slides.json> [--mock] [output.json]", file=sys.stderr)
        sys.exit(1)

    mock = "--mock" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--mock"]
    slides_path = args[0]
    output_path = args[1] if len(args) > 1 else None

    with open(slides_path) as f:
        slides = json.load(f)

    concepts = generate_concepts(slides, mock=mock)
    output = json.dumps(concepts, indent=2)
    if output_path:
        with open(output_path, "w") as f:
            f.write(output)
        print(f"Generated {len(concepts)} concepts -> {output_path}")
    else:
        print(output)


if __name__ == "__main__":
    main()
