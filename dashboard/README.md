# Dashboard (Phase 1 foundation)

A separate app from `game/` -- this is the tenant-facing admin dashboard:
sign in, create/manage an organization, set branding, upload content.
It talks to Supabase (Postgres + Auth + Storage), whose schema and RLS
policies live in `../supabase/migrations/`.

## Local development

Requires local Supabase running (see `../supabase/RLS-TESTING.md` for how
to start it -- `supabase start` from the repo root, needs Docker/colima).

```bash
cd dashboard
npm install
cp .env.example .env   # then fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
                        # for local dev, use the values `supabase start` printed
npm run dev
```

Opens on `http://localhost:5174` (the game client uses 5173).

## What's built

- **Auth**: email/password sign-up and sign-in (works with zero extra
  setup) via Supabase's official `@supabase/auth-ui-react` component.
  Google sign-in is wired into the UI but **needs Google OAuth
  credentials configured in the Supabase project before it'll actually
  work** -- see the root-level setup doc for exact steps once a cloud
  project exists.
- **Tenant creation**: a signed-in user with no org yet is prompted to
  create one (`create_tenant()` RPC -- see the migration), and becomes
  its owner.
- **Branding**: logo upload (to the `tenant-logos` Storage bucket,
  publicly readable) plus three brand colors (primary/accent/background),
  with a live preview using CSS custom properties (`--theme-*` in
  `src/index.css`). Only tenant admins/owners can change it -- enforced
  both in the UI (nav link hidden) and at the database layer (RLS), which
  is the one that actually matters.
- **Uploads**: upload a `.pptx` or a video/audio file, which creates a
  Storage object plus a `content_sets` row. The monthly usage cap
  (5/month free tier, 50/month paid -- see the migration for the exact
  policy and reasoning) is enforced by RLS on that insert, not just
  suggested in the UI.

## What's explicitly not built yet

- **The pipeline job runner.** Uploading a file today creates a
  `content_sets` row with `status: 'pending'` and stores the file --
  nothing actually runs `pipeline/ingest_pptx.py` /
  `generate_concepts.py` / `validate.py` against it yet. That's the next
  slice of Phase 1 work, not part of this pass.
- **Wiring the Phaser game client to this backend.** `game/` still reads
  `game/src/data/concepts.json` (a static file) and stores FSRS progress
  in `localStorage` only. Pointing it at real tenant-scoped data via this
  same Supabase project is a separate, follow-up change to `game/src/`.
- **Inviting teammates.** The RLS policies support it (an admin can
  insert a membership row for another user), but there's no UI for it --
  today the only way into an org is being the one who created it.

## How this was verified

No literal screenshot of the rendered UI in a real browser -- the two
browser-automation tools available in the session that built this either
block navigation to `localhost` (a real, intentional safety restriction)
or require an interactive macOS permission dialog that would hang
indefinitely if nobody's at the machine to click it (the same class of
problem as the GitHub device-code issue earlier in this project -- see
git history). Rather than force either, verification went two other
routes, both of which exercise the *real* system rather than something
mocked:

1. `npm run build` -- a clean production build, which catches real
   bundling/import/type errors a dev-server-only check wouldn't.
2. `integration_test.sh` -- a script that makes the exact HTTP calls the
   React code makes (sign up, `create_tenant()` RPC, fetch tenant, update
   branding, upload a logo to Storage, confirm it's publicly readable,
   create a content_set) directly against local Supabase's REST/Auth/
   Storage API. All 8 steps passed on a real run -- see the script for
   the exact requests and expected responses.

**This is a real gap, not a formality**: nobody has watched the actual
rendered pages, clicked the actual buttons, or seen the color pickers/
live preview update visually. `npm run dev` and a browser is a five-minute
check worth doing before this ships past personal testing -- flagging
plainly rather than implying more confidence than what was actually
checked.

### Local vs. cloud auth config differs -- known, not a bug

`supabase/config.toml` disables email confirmation (`enable_confirmations
= false`) for fast local testing. The real cloud project uses Supabase's
default of requiring email confirmation, plus a strict send-rate-limit on
its built-in (non-custom-SMTP) email service -- both hit immediately when
running `integration_test.sh` against the cloud project (`API_URL=...
bash integration_test.sh`), since that script expects signup to return a
session immediately, which only happens locally. This is correct,
appropriate production behavior, not something to weaken just to make an
automated test pass. Full authenticated-flow verification against the
live project was instead done a different way: confirming every
auth-gated endpoint (the `create_tenant()` RPC, `content_sets` insert,
`tenant-uploads` storage upload) correctly *rejects* unauthenticated
calls with the exact same RLS error signatures proven locally, plus
confirming `create_tenant()` rolls back atomically on failure (no
orphaned `tenants` row despite the function's own error message showing
what it would have inserted). The one thing that genuinely needs a real
inbox: a live human signing up with a real email and clicking the
confirmation link, which is the appropriate way to close this out rather
than automating around it.

```bash
# run the integration test yourself (local Supabase must be running):
bash integration_test.sh
```
