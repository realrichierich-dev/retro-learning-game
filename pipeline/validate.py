"""
Tier 3 (automated validation) -- the layer that replaces manual review for
everything except low-confidence items.

Three independent checks combine into one confidence score per concept:

  1. Deterministic checks (schema.py) -- free, instant, no AI.
  2. Grounding check -- is the marked-correct answer actually supported by
     the slide's own source text? Must produce a quoted span, not a bare
     yes/no.
  3. Self-consistency check -- shown the question blind (no marked answer),
     does an independent pass pick the same option?

mock mode simulates checks 2 and 3 with real (non-AI) logic operating on
the mock generator's own output, so the wiring and confidence-routing can
be proven without an API key. Real mode calls Claude twice more per
concept, separate from the generation call.
"""

import difflib
import json
import os
import sys

from schema import STATUS_AUTO_PUBLISHED, STATUS_FLAGGED, concept_shape_errors

MODEL = "claude-haiku-4-5-20251001"

# Confidence threshold above which an item auto-publishes without a human.
AUTO_PUBLISH_THRESHOLD = 0.7


def check_deterministic(concept: dict) -> tuple[bool, list[str]]:
    errors = concept_shape_errors(concept)
    return (len(errors) == 0, errors)


def check_duplicate(concept: dict, seen_prompts: list[str]) -> bool:
    """True if this question is a near-duplicate of one already seen."""
    prompt = concept["question"]["prompt"].strip().lower()
    for other in seen_prompts:
        ratio = difflib.SequenceMatcher(None, prompt, other).ratio()
        if ratio > 0.9:
            return True
    return False


def check_grounding_mock(concept: dict, source_text: str) -> dict:
    """Does source_span actually appear verbatim in the slide's source text?"""
    span = concept.get("source_span", "")
    found = bool(span) and span in source_text
    return {
        "pass": found,
        "quoted_span": span if found else None,
        "note": "verbatim substring match (mock mode)",
    }


def check_self_consistency_mock(concept: dict) -> dict:
    """
    Blind re-solve: given only the question + options (not told which is
    correct), pick whichever option is the verbatim source_span -- that's
    the same rule the mock generator used to mark the answer, so this
    checks the wiring rather than genuine model agreement. Real mode below
    does this with an actual independent model call.
    """
    options = concept["question"]["options"]
    span = concept.get("source_span", "")
    try:
        independent_index = options.index(span)
    except ValueError:
        independent_index = -1
    agrees = independent_index == concept["question"]["correct_index"]
    return {"agrees": agrees, "independent_answer_index": independent_index}


GROUNDING_PROMPT = """Source text:
{source}

Question: {prompt}
Claimed correct answer: {answer}

Does the source text actually support this answer? Reply with ONLY a JSON object:
{{"supported": true|false, "quoted_span": "exact quote from source text that supports it, or empty string"}}
The quoted_span must be an exact substring of the source text above, or empty if not supported."""

SELF_CONSISTENCY_PROMPT = """Source text:
{source}

Question: {prompt}
Options:
{options}

Based only on the source text, which option is correct? Reply with ONLY a JSON object:
{{"correct_index": 0}}"""


def _call_claude_json(client, model, prompt):
    response = client.messages.create(
        model=model, max_tokens=300, messages=[{"role": "user", "content": prompt}]
    )
    return json.loads(response.content[0].text.strip())


def check_grounding_real(client, concept: dict, source_text: str) -> dict:
    result = _call_claude_json(
        client,
        MODEL,
        GROUNDING_PROMPT.format(
            source=source_text,
            prompt=concept["question"]["prompt"],
            answer=concept["question"]["options"][concept["question"]["correct_index"]],
        ),
    )
    span = result.get("quoted_span") or ""
    verified = bool(span) and span in source_text
    return {"pass": bool(result.get("supported")) and verified, "quoted_span": span or None, "note": "LLM grounding pass"}


def check_self_consistency_real(client, concept: dict) -> dict:
    options_text = "\n".join(f"{i}: {o}" for i, o in enumerate(concept["question"]["options"]))
    result = _call_claude_json(
        client,
        MODEL,
        SELF_CONSISTENCY_PROMPT.format(
            source=concept.get("source_span", ""),
            prompt=concept["question"]["prompt"],
            options=options_text,
        ),
    )
    independent_index = result.get("correct_index", -1)
    agrees = independent_index == concept["question"]["correct_index"]
    return {"agrees": agrees, "independent_answer_index": independent_index}


def validate_concepts(concepts: list[dict], slides_by_index: dict, mock: bool) -> list[dict]:
    client = None
    if not mock:
        import anthropic

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set; run with --mock or export a key.")
        client = anthropic.Anthropic(api_key=api_key)

    validated = []
    seen_prompts = []

    for concept in concepts:
        slide = slides_by_index[concept["_source_slide_index"]]
        source_text = "\n".join([slide["title"], *slide["bullets"], slide["notes"]])

        det_pass, det_errors = check_deterministic(concept)
        is_dup = check_duplicate(concept, seen_prompts)
        seen_prompts.append(concept["question"]["prompt"].strip().lower())

        if mock:
            grounding = check_grounding_mock(concept, source_text)
            consistency = check_self_consistency_mock(concept)
        else:
            grounding = check_grounding_real(client, concept, source_text)
            consistency = check_self_consistency_real(client, concept)

        checks_passed = sum([det_pass, not is_dup, grounding["pass"], consistency["agrees"]])
        confidence = checks_passed / 4

        status = STATUS_AUTO_PUBLISHED if (det_pass and not is_dup and confidence >= AUTO_PUBLISH_THRESHOLD) else STATUS_FLAGGED

        concept["validation"] = {
            "deterministic_pass": det_pass,
            "deterministic_errors": det_errors,
            "duplicate": is_dup,
            "grounding": grounding,
            "self_consistency": consistency,
            "confidence_score": round(confidence, 2),
            "status": status,
        }
        validated.append(concept)

    return validated


def main():
    if len(sys.argv) < 3:
        print("usage: python validate.py <slides.json> <concepts.json> [--mock] [output.json]", file=sys.stderr)
        sys.exit(1)

    mock = "--mock" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--mock"]
    slides_path, concepts_path = args[0], args[1]
    output_path = args[2] if len(args) > 2 else None

    with open(slides_path) as f:
        slides = json.load(f)
    with open(concepts_path) as f:
        concepts = json.load(f)

    slides_by_index = {s["slide_index"]: s for s in slides}
    validated = validate_concepts(concepts, slides_by_index, mock=mock)

    auto = sum(1 for c in validated if c["validation"]["status"] == STATUS_AUTO_PUBLISHED)
    flagged = len(validated) - auto
    print(f"Validated {len(validated)} concepts: {auto} auto-published, {flagged} flagged for review.")

    output = json.dumps(validated, indent=2)
    if output_path:
        with open(output_path, "w") as f:
            f.write(output)
        print(f"-> {output_path}")
    else:
        print(output)


if __name__ == "__main__":
    main()
