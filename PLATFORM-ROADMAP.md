# Platform Roadmap: From Personal Tool to Multi-Tenant SaaS

*Planning document only. Nothing in this doc has been built. No product code
changed as part of writing it.*

## Why this doc exists

The current project (`game/` + `pipeline/`) is a working single-tenant proof
of concept: one deck, one browser's `localStorage`, one person (Rich) running
the content pipeline by hand. Turning it into something a school district or
a corporate L&D team can sign up for, upload their own content to, and pay
for is a different kind of system — it needs accounts, a database, a real
backend, and money moving through Stripe. None of that exists today. This
doc lays out what has to get built, in what order, and what of the current
code survives the jump.

**Bottom line up front:** the *game client* and the *content pipeline logic*
are both genuinely reusable — that's the actual product IP and none of it
gets thrown away. What's missing is everything *around* them: a server, a
database, auth, and a way to run the pipeline on someone else's behalf
instead of Rich's own machine.

---

## 1. What exists today (grounded in the actual repo)

- **`game/`** — Phaser 3 + Vite. A static site, nothing else. Built with
  `npm run build`, deployed to GitHub Pages by
  `.github/workflows/deploy.yml`. No server-side code runs, ever.
  - `BootScene.js` loads content via a hardcoded `import concepts from
    "../data/concepts.json"` — a single JSON file baked into the JS bundle
    at build time. There is no concept of "which user," "which
    organization," or "which content set" — there's exactly one.
  - `scheduler.js` (FSRS spaced-repetition state) reads/writes
    `localStorage` only, keyed `retro-learning-game:fsrs-cards`. Progress
    lives in one browser, tied to one device, with no account behind it.
  - Colors/branding are hardcoded: `COLORS` object in `BattleScene.js`,
    `MONSTER_COLORS` array in `OverworldScene.js`, inline `<style>` in
    `index.html`. Nothing is theme-able today.
- **`pipeline/`** — Python CLI scripts (`run_pipeline.py` and friends) run
  manually on Rich's Mac. They call the Anthropic API (concept generation,
  grounding check, self-consistency check) and OpenAI's Whisper API (video
  transcription), reading API keys from a local `pipeline/.env` file, and
  write results to local JSON files (`pipeline/output/concepts.json`) that
  get manually copied into `game/src/data/concepts.json`.
- **No server.** No database. No auth. No file storage service. No
  payments. No concept of a "user" or "organization" anywhere in the code.

This is about as far from multi-tenant SaaS as a codebase can be — not
because anything was done wrong (it's a correct, intentionally minimal
MVP), but because the entire premise so far has been "one person, one
deck, one browser." Getting to multi-tenant is a real backend build, not
an incremental patch.

---

## 2. Reuse vs. rework

| Piece | Verdict | Why |
|---|---|---|
| Phaser game scenes (`OverworldScene.js`, `BattleScene.js`) | **Reuse, light rework** | Game logic (battles, FSRS turn flow, boss fights) doesn't care where data comes from. Needs: colors pulled from a theme object instead of hardcoded constants; concept-loading swapped from static import to an authenticated fetch. |
| `scheduler.js` (FSRS) | **Reuse, extend** | The FSRS math and card shape are correct and provider-agnostic. Needs a sync layer added on top: keep `localStorage` as an offline cache, but write-through to a backend so progress survives a new device/browser. |
| `pipeline/ingest_pptx.py`, `ingest_video.py`, `generate_concepts.py`, `validate.py`, `schema.py` | **Reuse almost as-is** | This is the actual hard-won IP — the mock/real generation split, the three-check validation layer, the concept JSON schema. The logic doesn't need to change. What changes is *how it's invoked*: today it's a local CLI a human runs; in SaaS it has to become a job triggered by an upload, reading from tenant-scoped storage and writing to tenant-scoped DB rows instead of local files. |
| Static hosting (GitHub Pages / Cloudflare) | **Keep for the JS bundle, add a real backend alongside** | The Phaser client can and should stay a static, CDN-hosted bundle for cost/speed reasons. It just needs to talk to a real API at runtime for anything tenant-specific (content, progress, branding) instead of having everything baked in at build time. |
| `localStorage`-only progress model | **Rework required** | This is the one piece that's a genuine dead end for SaaS — there's no account to migrate progress *to* today, but going forward this has to become "server is the source of truth, localStorage is a cache," not the other way around. |
| Hardcoded colors/branding | **Rework required** | Every color is a JS constant or inline CSS today. Needs to become a theme object (logo URL + a handful of hex colors) fetched per-tenant at boot and threaded through scene creation. |

---

## 3. Phased roadmap

### Phase 1 — Foundation: auth, tenant data model, branding, uploads

**Goal:** a logged-in user belonging to an organization can upload a deck,
see it turn into a playable module, and play it with their org's branding —
for one pilot customer, end to end.

**Build:**
- Stand up Supabase (Postgres + Auth + Storage + RLS) — see Section 4 for
  the Supabase-vs-Clerk decision this depends on.
- Core schema: `tenants`, `memberships` (user ↔ tenant, with a role),
  `content_sets` (one per uploaded deck/video), `concepts` (the DB version
  of today's flat `concepts.json` — the shape in `schema.py` maps onto
  this almost directly), `fsrs_cards` (per-user, per-concept — replaces
  the `localStorage`-only model), `branding_configs` (logo URL + colors,
  one per tenant).
- Every table gets a `tenant_id` column and an RLS policy scoping all
  reads/writes to the caller's tenant. This is the actual multi-tenancy
  mechanism — not a separate database or schema per customer.
- A minimal backend (Supabase Edge Functions, or a small FastAPI/Node
  service if the logic outgrows Edge Functions) exposing: login, "list my
  tenant's concepts," "record a battle result" (writes to `fsrs_cards`),
  "upload a deck/video."
- Wire the **existing** pipeline scripts into this backend as an async job:
  upload lands in Storage → job reads it → runs `ingest_pptx`/`ingest_video`
  → `generate_concepts` → `validate` (all reused, near-unchanged) → writes
  rows into `concepts` scoped to that tenant/content set. This has to be
  **async** — a Whisper transcription + several LLM calls can take way
  longer than an HTTP request should block for. Needs a job queue of some
  kind (a simple `jobs` table + polling worker is enough at pilot scale;
  something like Inngest/Trigger.dev if it needs to get fancier later).
- Game client changes: `BootScene.js` swaps the static `concepts.json`
  import for an authenticated fetch scoped to the logged-in user's tenant;
  `scheduler.js` gets a sync layer (write-through to `fsrs_cards`, read
  cache from `localStorage` for offline/fast boot); `BattleScene.js` /
  `OverworldScene.js` pull colors from a theme object fetched at boot
  instead of the hardcoded `COLORS` constant.
- A bare-bones admin UI (new — doesn't exist today) for a tenant admin to
  upload content and set logo/colors. Doesn't need to be pretty for Phase 1.

**Est. cost at pilot scale:** Supabase free tier covers a lot (50K MAU auth,
generous DB/storage limits) — realistically $0–25/mo (Pro tier) for the
first several pilot customers. Backend compute (Edge Functions or a small
Workers/Vercel deployment) is free-tier-viable at this volume. LLM/Whisper
costs are the same per-deck cents already measured in this repo's README,
just now metered per tenant instead of run ad hoc.

### Phase 2 — Security & compliance hygiene for school pilots

**Goal:** a school district's IT/legal reviewer looks at this and is
comfortable signing off, without needing a full SOC 2 report.

**Build:**
- RLS policy audit: every table gets tested for the "wrong tenant can't
  read/write" case explicitly, not just assumed correct.
- Verify TLS 1.3 and encryption-at-rest are actually on (both are Supabase
  defaults, but "verify, don't assume" for anything going to a school).
- An access-log / audit-trail table (who touched what tenant's data, when)
  — schools and compliance-minded corp customers will ask for this.
- A FERPA-oriented Data Processing Agreement template — this is a **legal
  document**, not code; Rich (likely with a lawyer, at least for the first
  version) needs to own this, not something to auto-generate.
- Secrets management: today's `pipeline/.env` pattern is fine for a local
  CLI but wrong for a hosted backend — move to the hosting platform's
  proper env/secrets store.
- Basic abuse/cost controls: rate limits on upload and LLM-call endpoints,
  and a per-tenant usage cap tied to plan tier — this matters as much for
  cost control (someone shouldn't be able to run up an unbounded Anthropic
  bill) as for security.

**Est. cost:** mostly engineering time, not infrastructure. Maybe a
logging/monitoring tool if Supabase's built-in logs aren't enough —
$0–30/mo range (e.g. Sentry free tier).

### Phase 3 — Billing

**Goal:** a corporate customer or individual course creator can actually
pay, on a plan tied to their organization (not per-user), while schools
stay free.

**Build:**
- Stripe Checkout + Billing Portal, tied to `tenant_id` (per Rich's own
  research — org-level billing, not per-user, since school vs. corp vs.
  solo-creator need different tiers and corp likely wants seat-based
  pricing).
- A `subscriptions`/plan-tier table and entitlement checks in the backend
  (max content sets, max MAU, feature gates) enforced on the same
  endpoints built in Phase 1.
- Stripe webhook handling for the subscription lifecycle (created,
  updated, canceled, payment failed).
- **Open question, not solved by this doc:** how does a school actually
  *prove* it's a school to get the free tier — `.edu`/district email
  domain check, or a manual approval queue? Needs a decision before this
  phase ships, not a blocker to planning it now.

**Est. cost:** Stripe itself has no fixed fee — 2.9% + 30¢ per transaction,
scales with revenue by design. No new infra cost beyond what Phase 1/2
already stood up.

### Phase 4 — Enterprise hardening

**Goal:** the platform can credibly bid on a large district or enterprise
contract that specifically asks for SSO and a SOC 2 report.

**Build (each of these is its own real project, not a checkbox):**
- SSO (SAML/OIDC) — both Supabase Auth and Clerk gate this behind a paid
  enterprise add-on; a dedicated SSO-only provider (e.g. WorkOS) is a
  common cheaper alternative many indie SaaS use instead of paying full
  enterprise-tier pricing on their main auth vendor just for this one
  feature. Worth comparing at the time, not deciding now.
- SOC 2 Type II — a compliance-automation tool (Vanta, Drata — roughly
  $10–30K/year) plus an external audit (roughly $15–50K+ for Type II,
  varies a lot by scope/auditor) plus months of process work. This is
  genuinely expensive and slow; per Rich's own framing, it's a later-stage
  investment once real enterprise deal-flow justifies it, not a launch
  blocker.
- Custom domains per tenant (white-labeling).
- A "dedicated" isolation tier for the largest customers who want stronger
  guarantees than shared-table RLS — worth having as a story even if the
  default (and 95% of customers) stay on the shared-table model.

**Est. cost:** low-to-mid five figures minimum just for SOC 2 tooling +
audit, before any engineering time. This is the one phase where "rough
cost estimate" genuinely means "get real quotes when you're closer," not
something to plan precisely today.

---

## 4. Architectural decisions Rich should weigh in on

These are real forks, not things I picked silently:

1. **Supabase vs. Clerk for auth.** My read of the tradeoff you already
   researched: Supabase gives you Auth + Postgres + Storage + RLS as one
   coherent system, which minimizes integration surface and cost — that
   favors Supabase for Phase 1, where "ship the foundation cheaply" is the
   goal. Clerk's nicer out-of-the-box org/invite UX matters more once
   onboarding a new corporate customer's whole team is a frequent,
   friction-sensitive event — that's more a Phase 3+ concern. A hybrid
   (Clerk for auth, Supabase for DB/storage) is possible but adds real
   complexity syncing Clerk user IDs into Postgres RLS policies. **My
   default recommendation is Supabase-only for Phase 1**, revisit Clerk
   specifically if org/invite UX becomes a real sales friction point —
   but this is your call to make, not mine to lock in.

2. **Keep Phaser/Vite as-is, or restructure?** My assessment: **no
   restructuring needed.** Phaser is a rendering/game-logic layer; it
   doesn't care whether its data comes from a static import or an
   authenticated fetch. The real work is entirely in the *data layer*
   (Section 2/3 above), not the game code itself. This is good news — the
   game-feel work from this whole session (battles, boss fights, FSRS,
   visual pass) is not at risk of being thrown away.

3. **Who pays for LLM/Whisper calls, and how is abuse prevented?** Three
   options: platform absorbs all cost (needs hard per-tenant caps,
   especially on the free school tier), tenants bring their own API keys
   (more setup friction, unlikely for schools), or metered pass-through
   billing (the "most SaaS" answer, but real billing complexity). My
   leaning: platform-pays-with-hard-caps for free/school tier, and
   plan-tier-limited for paid tiers — but flagging this explicitly since
   it's a real product decision, not just an engineering one.

4. **Data residency / school-specific requirements beyond generic FERPA.**
   Some districts have state-specific student-privacy requirements (e.g.
   California's SOPIPA) or US-only data-residency asks. Not solvable
   generically here — needs research once actual school pilots are lined
   up and asking specific questions.

5. **Shared-table RLS is the right *starting* isolation model** (per your
   research, and it's genuinely the standard, cost-effective approach),
   but flagging now that some enterprise customers will eventually want
   stronger isolation than "same tables, different `tenant_id`." That's
   the Phase 4 "dedicated tier" item — not a reason to second-guess the
   Phase 1 approach.

---

## 5. What this doc deliberately does not do

- It doesn't pick a product name.
- It doesn't write a DPA, a SOC 2 policy, or any other legal/compliance
  document — those need a human (likely a lawyer) in the loop, not
  generated text.
- It doesn't touch `game/` or `pipeline/` — this is planning only, per the
  request that started it.
- It doesn't commit to exact pricing tiers/dollar amounts for the product
  itself — that's a business decision this doc intentionally stays out of.
