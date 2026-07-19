"""
The async job runner Phase 1 was missing: picks up 'pending' content_sets
(created by the dashboard's upload flow -- see dashboard/src/pages/
Uploads.tsx), runs them through the *existing, unchanged* ingest/generate/
validate pipeline, and writes the result back as real, playable `concepts`
rows -- closing the loop from "uploaded a file" to "game-ready content."

Nothing in ingest_pptx.py / ingest_video.py / generate_concepts.py /
validate.py changes for this. This script is glue: pull a pending row,
download its file from Storage, hand it to the same functions
run_pipeline.py already calls for local CLI use, write the result to
Postgres instead of a local JSON file.

Architecture note (why this, not a Supabase Edge Function): Edge
Functions run on Deno, not Python. The whole point here is reusing the
tested pipeline as-is, not rewriting python-pptx/anthropic/openai calls
in TypeScript. A polling worker is the right level of engineering for
pre-revenue-MVP upload volume -- no new hosting account, no queue
service, just a script that can run one-shot (cron/manual) or as a
--watch loop.

Requires SUPABASE_SERVICE_ROLE_KEY (the "secret key" in Supabase's
current naming) in pipeline/.env -- this bypasses RLS by design, which is
exactly what a trusted server-side process needs to read/write across
every tenant. This must never be the same key used in dashboard/.env
(that one -- the publishable/anon key -- is the browser-safe one; this
one is not).

Usage:
  python job_runner.py                  # process all pending rows once, exit
  python job_runner.py --watch           # loop forever, poll every 20s
  python job_runner.py --watch --interval 60
  python job_runner.py --mock            # rule-based generation, no LLM calls/cost
"""

import argparse
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from generate_concepts import generate_concepts
from ingest_pptx import extract_slides as extract_slides_pptx
from ingest_video import extract_slides_from_video
from schema import STATUS_AUTO_PUBLISHED, STATUS_FLAGGED
from validate import validate_concepts

UPLOADS_BUCKET = "tenant-uploads"
POLL_INTERVAL_DEFAULT = 20


def get_client():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in pipeline/.env. "
            "This is the project's secret/service_role key (Project Settings -> API in the "
            "Supabase dashboard) -- NOT the publishable key used in dashboard/.env. It bypasses "
            "RLS, which is required for this worker to read/write across every tenant; keep it "
            "out of anything browser-facing. See pipeline/README_JOB_RUNNER.md."
        )
    return create_client(url, key)


def claim_pending(client) -> list[dict]:
    """
    Fetch pending content_sets and atomically claim each one (flip to
    'processing' with a WHERE status='pending' guard) so two overlapping
    runs of this script -- e.g. cron overlap, or a --watch loop plus a
    manual run -- can't both pick up the same row.
    """
    pending = client.table("content_sets").select("*").eq("status", "pending").execute().data
    claimed = []
    for row in pending:
        result = (
            client.table("content_sets")
            .update({"status": "processing"})
            .eq("id", row["id"])
            .eq("status", "pending")
            .execute()
        )
        if result.data:
            claimed.append(row)
    return claimed


def download_source_file(client, storage_path: str, dest_dir: str) -> str:
    data = client.storage.from_(UPLOADS_BUCKET).download(storage_path)
    local_path = os.path.join(dest_dir, os.path.basename(storage_path))
    with open(local_path, "wb") as f:
        f.write(data)
    return local_path


def concept_to_row(concept: dict, tenant_id: str, content_set_id: str) -> dict:
    return {
        "tenant_id": tenant_id,
        "content_set_id": content_set_id,
        "title": concept["title"],
        "tags": concept.get("tags", []),
        "difficulty": concept.get("difficulty", "medium"),
        "dialogue": concept.get("dialogue", ""),
        "source_span": concept.get("source_span", ""),
        "question": concept["question"],
        "validation": concept.get("validation", {}),
    }


def process_one(client, content_set: dict, mock: bool):
    cs_id = content_set["id"]
    tenant_id = content_set["tenant_id"]
    title = content_set["title"]
    source_type = content_set["source_type"]
    storage_path = content_set["source_storage_path"]

    print(f"[{cs_id}] processing '{title}' (tenant={tenant_id}, type={source_type})")

    if not storage_path:
        raise RuntimeError("content_set has no source_storage_path -- nothing to process")

    with tempfile.TemporaryDirectory() as tmp:
        local_path = download_source_file(client, storage_path, tmp)
        print(f"[{cs_id}] downloaded -> {local_path}")

        if source_type == "pptx":
            slides = extract_slides_pptx(local_path)
        elif source_type in ("video", "txt"):
            slides = extract_slides_from_video(local_path, mock=mock)
        else:
            raise RuntimeError(f"unknown source_type: {source_type}")

        print(f"[{cs_id}] extracted {len(slides)} slides/segments")

        concepts = generate_concepts(slides, mock=mock)
        print(f"[{cs_id}] generated {len(concepts)} concepts ({'mock' if mock else 'real LLM'} mode)")

        slides_by_index = {s["slide_index"]: s for s in slides}
        validated = validate_concepts(concepts, slides_by_index, mock=mock)

        auto_published = [c for c in validated if c["validation"]["status"] == STATUS_AUTO_PUBLISHED]
        flagged = [c for c in validated if c["validation"]["status"] == STATUS_FLAGGED]
        print(f"[{cs_id}] {len(auto_published)} auto-published, {len(flagged)} flagged")

        if auto_published:
            rows = [concept_to_row(c, tenant_id, cs_id) for c in auto_published]
            client.table("concepts").insert(rows).execute()

        review_notes = (
            [{"title": c["title"], "reason": c["validation"]} for c in flagged] if flagged else None
        )
        client.table("content_sets").update(
            {"status": "ready", "review_notes": review_notes, "error_message": None}
        ).eq("id", cs_id).execute()

        print(f"[{cs_id}] done -> status=ready")


def run_once(client, mock: bool) -> int:
    claimed = claim_pending(client)
    if not claimed:
        return 0
    for content_set in claimed:
        try:
            process_one(client, content_set, mock=mock)
        except Exception as e:
            print(f"[{content_set['id']}] FAILED: {e}", file=sys.stderr)
            traceback.print_exc()
            client.table("content_sets").update(
                {"status": "failed", "error_message": str(e)}
            ).eq("id", content_set["id"]).execute()
    return len(claimed)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true", help="loop forever instead of processing once and exiting")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_DEFAULT, help="poll interval in seconds for --watch")
    parser.add_argument("--mock", action="store_true", help="force mock mode -- no API keys/cost, proves the wiring")
    args = parser.parse_args()

    if not args.mock and not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "NOTE: ANTHROPIC_API_KEY not set -- forcing --mock (no account/payment needed). "
            "Set it in pipeline/.env and re-run without --mock for real content.",
            file=sys.stderr,
        )
        args.mock = True

    client = get_client()

    if args.watch:
        print(f"Watching for pending content_sets every {args.interval}s (Ctrl+C to stop)...")
        while True:
            n = run_once(client, mock=args.mock)
            if n:
                print(f"processed {n} content_set(s)")
            time.sleep(args.interval)
    else:
        n = run_once(client, mock=args.mock)
        print(f"Done. Processed {n} pending content_set(s).")


if __name__ == "__main__":
    main()
