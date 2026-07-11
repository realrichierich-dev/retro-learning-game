"""
Shared JSON shape for concept nodes, used by every pipeline stage.

A "concept" moves through three shapes as it flows through the pipeline:
  1. raw slide dict (from ingest_pptx.py)
  2. generated concept dict (from generate_concepts.py) -- adds question/dialogue/source_span
  3. validated concept dict (from validate.py) -- adds a "validation" block and "status"

SCHEMA_VERSION exists so the game client and pipeline can detect a mismatch later.
"""

SCHEMA_VERSION = 1

# Statuses a concept can end up with after validate.py
STATUS_AUTO_PUBLISHED = "auto_published"
STATUS_FLAGGED = "flagged_for_review"

REQUIRED_CONCEPT_FIELDS = [
    "concept_id",
    "title",
    "tags",
    "difficulty",
    "dialogue",
    "source_span",
    "question",
]

REQUIRED_QUESTION_FIELDS = ["prompt", "options", "correct_index"]


def concept_shape_errors(concept: dict) -> list[str]:
    """Deterministic, non-AI shape checks. Returns a list of problems (empty = OK)."""
    errors = []
    for field in REQUIRED_CONCEPT_FIELDS:
        if field not in concept:
            errors.append(f"missing field: {field}")
    if "question" in concept:
        q = concept["question"]
        for field in REQUIRED_QUESTION_FIELDS:
            if field not in q:
                errors.append(f"missing question field: {field}")
        if "options" in q:
            options = q["options"]
            if not isinstance(options, list) or len(options) != 4:
                errors.append("question.options must be a list of exactly 4 items")
            if len(set(o.strip().lower() for o in options if isinstance(o, str))) != len(options):
                errors.append("question.options contains duplicate/near-duplicate entries")
        if "correct_index" in q and "options" in q:
            idx = q["correct_index"]
            if not isinstance(idx, int) or not (0 <= idx < len(q.get("options", []))):
                errors.append("question.correct_index out of range")
    return errors
