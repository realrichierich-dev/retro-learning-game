-- Capture point for pipeline output the job runner shouldn't silently
-- discard: concepts the validation layer flagged (Tier 3/4 in the build
-- plan -- deterministic checks / grounding / self-consistency didn't
-- clear the auto-publish bar) don't become playable `concepts` rows, but
-- they still need to land *somewhere* rather than vanish. This is
-- deliberately not a review-queue table/UI (that's real, separate,
-- later work) -- just enough structure that a flagged item is visible
-- in the data instead of gone.
alter table public.content_sets
  add column review_notes jsonb;

comment on column public.content_sets.review_notes is
  'Concepts the job runner generated but did not auto-publish (validation flagged them), plus a short reason each. Not a review queue UI -- just avoids silently dropping data. See pipeline/job_runner.py.';
