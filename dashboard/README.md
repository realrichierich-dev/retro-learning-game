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

Three checks, each catching a different class of problem:

1. `npm run build` -- a clean production build, which catches real
   bundling/import/type errors a dev-server-only check wouldn't.
2. `integration_test.sh` -- a script that makes the exact HTTP calls the
   React code makes (sign up, `create_tenant()` RPC, fetch tenant, update
   branding, upload a logo to Storage, confirm it's publicly readable,
   create a content_set) directly against Supabase's REST/Auth/Storage
   API. Proves the backend contract works.
3. `smoke-test.mjs` -- a headless real-browser check (Playwright) that
   loads the app and fails on any console/page error or a blank `#root`.
   Proves the frontend actually renders, which the other two checks
   cannot: **this is what an earlier version of this doc called out as a
   real, unverified gap, and it caught a real bug the first time it ran.**

```bash
npm run dev              # in one terminal
npm run smoke-test       # in another (needs: npx playwright install chromium, once)
```

### A real bug this caught: blank page from a duplicate React copy

The dashboard rendered a totally blank page in an actual browser --
`npm run build` and `tsc --noEmit` both passed clean, so this was
invisible to every static check. `@supabase/auth-ui-react` (last
published Jan 2024, no release since) declares `react`/`react-dom`
`^18.2.0` as regular dependencies rather than peer dependencies, and this
app uses React 19 -- so npm nested a second, incompatible copy of React
18 just for that package. When its component called `useState`, it hit
its own bundled React's hook dispatcher, which had no active render
context in the app's actual React 19 tree: `Cannot read properties of
null (reading 'useState')`, silently, with nothing reaching the DOM.

Fixed by removing `@supabase/auth-ui-react`/`@supabase/auth-ui-shared`
entirely (abandoned, no React 19 support to upgrade to) and hand-rolling
the login form directly against `supabase-js`'s own
`signInWithPassword`/`signUp`/`signInWithOAuth` -- less code than it
sounds like, and removes a dead dependency rather than pinning the whole
app to React 18 to accommodate it. `smoke-test.mjs` confirmed the fix
(clean run, form renders, zero errors) before this was called done.

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
