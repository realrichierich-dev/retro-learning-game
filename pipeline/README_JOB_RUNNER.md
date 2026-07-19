# Job runner

`job_runner.py` is what turns an upload from the dashboard into real,
playable quiz content. Uploading a file (`dashboard/src/pages/Uploads.tsx`)
only creates a `content_sets` row (`status: 'pending'`) and stores the file
in Supabase Storage -- it does not run any content generation itself. This
script is the piece that closes that loop.

It does not change `ingest_pptx.py`, `ingest_video.py`,
`generate_concepts.py`, or `validate.py` at all -- same functions
`run_pipeline.py`'s local CLI already calls, same behavior, same `--mock`
option. The only new code is the glue: poll Postgres for pending rows,
download the tenant's file from Storage, run it through the pipeline,
write the result back as `concepts` rows instead of a local JSON file.

## Setup (one-time)

```bash
cd pipeline
pip install -r requirements.txt   # adds the `supabase` client
```

Add two values to `pipeline/.env` (placeholders already there with
instructions):

```
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

Get both from the Supabase dashboard -> Project Settings -> API. The
service role/secret key is **not** the same key used in `dashboard/.env`
(that's the publishable/anon key, safe for a browser). This one bypasses
Row Level Security by design -- required for a server-side worker that
processes uploads across every tenant -- and must never end up in
`dashboard/` or anything `VITE_`-prefixed.

## Running it

```bash
python job_runner.py                    # process every pending row once, exit
python job_runner.py --mock              # same, but rule-based generation -- no API cost, proves the wiring
python job_runner.py --watch             # loop forever, polling every 20s
python job_runner.py --watch --interval 60
```

If `ANTHROPIC_API_KEY` isn't set, it forces `--mock` automatically rather
than failing, so this is safe to run without cost by default.

## What it does, per pending row

1. Claims the row: `status` `pending` -> `processing`, guarded by a
   `WHERE status = 'pending'` on the update so two overlapping runs (e.g.
   a cron job and a manual run) can't double-process the same upload.
2. Downloads the file from the `tenant-uploads` Storage bucket at the
   path the dashboard wrote (`{tenant_id}/{timestamp}-{filename}`).
3. Extracts slides/segments (`ingest_pptx.py` for `.pptx`,
   `ingest_video.py` for video/audio and `.txt` transcripts).
4. Generates concepts (`generate_concepts.py`) and validates them
   (`validate.py` -- deterministic checks, grounding, self-consistency,
   confidence score).
5. Concepts that clear the auto-publish bar become `concepts` rows.
   Concepts the validator flagged are recorded in
   `content_sets.review_notes` (title + reason) instead of silently
   dropped -- this is a data capture point, not a review-queue UI; that's
   separate, later work if it's ever needed.
6. Sets `status = 'ready'`. On any exception, sets `status = 'failed'`
   and records `error_message` instead of leaving the row stuck on
   `processing`.

## Not built (deliberately out of scope for this pass)

- **Scheduling.** This script processes what's pending right now (or
  polls at an interval with `--watch`); it isn't hooked up to cron/launchd
  or a hosted always-on process yet. For a first real test, running it
  manually after an upload is enough.
- **The game reading this data.** `concepts` rows exist in Postgres now,
  but `game/` still reads a static local JSON file -- pointing it at this
  table is separate follow-up work (see `PLATFORM-ROADMAP.md`).
- **Retry/backoff on transient failures.** A row that fails (e.g. a
  network blip mid-download) goes straight to `status: 'failed'` rather
  than being retried automatically. Re-running the pipeline on a failed
  row today means manually flipping its `status` back to `pending` in the
  database -- fine at pilot scale, worth revisiting before real customer
  traffic.
