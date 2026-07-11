# Retro Learning Game

Turns a PowerPoint deck into a playable, retro-style quiz game: a Zelda-ish
overworld map where walking into a "monster" starts a Pokémon-style
battle -- the "attack" is answering a question generated from your slides.

This is the **MVP**: it proves the full pipeline works end to end
(slides in -> playable quiz-battle out). It intentionally does NOT yet
include video ingestion, spaced-repetition scheduling, a real art/audio
pass, or multi-question battles -- see "What's next" below. The full
design reasoning lives in the original build plan doc Rich has.

## How it's organized

```
retro-learning-game/
  pipeline/     Python: turns a .pptx into game-ready quiz data
  game/         Phaser 3 (JavaScript) browser game that plays that data
```

The two halves talk to each other through one file:
`game/src/data/concepts.json`. The pipeline writes it, the game reads it.
That file is checked into the repo so the game has playable content even
if you never touch the pipeline.

## The pipeline (`pipeline/`)

Three stages, chained by `run_pipeline.py`:

1. **`ingest_pptx.py`** -- pulls slide titles, bullet text, and speaker
   notes out of a `.pptx` file (using `python-pptx`). No AI involved,
   purely mechanical extraction.
2. **`generate_concepts.py`** -- turns each slide into a "concept": a
   title, a bit of monster/NPC flavor text, and a 4-option quiz question.
   Has two modes:
   - `--mock`: rule-based, no API key needed. The "correct" answer is a
     verbatim sentence from that slide; the wrong answers are verbatim
     sentences from *other* slides in the deck. This is what proves the
     pipeline works without needing to pay for anything.
   - real mode (default if `ANTHROPIC_API_KEY` is set): calls Claude to
     generate genuinely new questions instead of quoting sentences.
3. **`validate.py`** -- the automated quality-control layer, so most
   content doesn't need a human to eyeball it:
   - **Deterministic checks** (free, instant): exactly one correct
     answer, no duplicate/near-duplicate questions, right shape.
   - **Grounding check**: is the answer actually backed by a quoted
     span from the source slide? (In mock mode this is a literal
     substring check; in real mode it's a second, independent LLM call.)
   - **Self-consistency check**: shown the question *blind* (without
     being told the answer), does an independent pass agree?
   - These combine into a confidence score. High-confidence items
     auto-publish into the game. Anything else goes to
     `pipeline/output/review_queue.json` instead of blocking the rest
     of the deck.

Run it:

```bash
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# generates a small sample deck about the solar system, if you don't have one handy
.venv/bin/python make_sample_deck.py sample_deck.pptx

# runs the full pipeline (auto-falls-back to --mock if no API key is set)
.venv/bin/python run_pipeline.py sample_deck.pptx

# to use your own deck instead:
.venv/bin/python run_pipeline.py /path/to/your_deck.pptx

# copy the result into the game so it picks up the new content:
cp output/concepts.json ../game/src/data/concepts.json
```

**Using real LLM generation instead of mock:**

1. Create a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) -- needs an Anthropic account with billing enabled. I did not create one or spend any money; that's Rich's call.
2. `cp pipeline/.env.example pipeline/.env` and paste the key in as `ANTHROPIC_API_KEY=...`. `.env` is gitignored, so it never gets committed.
3. Run `run_pipeline.py` without `--mock` (e.g. `.venv/bin/python run_pipeline.py sample_deck.pptx`). The `.env` file is loaded automatically -- no need to `export` anything by hand each session.

Cost for the 6-slide sample deck is a fraction of a cent using the default Haiku model (three LLM calls per concept: generation + grounding check + self-consistency check -- see the "Cost" section below).

## The game (`game/`)

Phaser 3 + Vite. No build step needed to develop -- Vite serves it live.

```bash
cd game
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`).

**How to play:** arrow keys / WASD to walk around. Walking into a
colored monster starts a battle. Read the question, click (or press
1-4) to answer. Correct = the monster is defeated permanently. Wrong =
you lose a heart and the monster stays -- come back and try again.
Progress (which concepts you've beaten) is saved to the browser's
`localStorage`, so it survives a page refresh.

Everything is drawn with simple colored rectangles rather than a
licensed pixel-art pack -- that keeps the MVP at zero art cost. Swapping
in a real CC0 asset pack later is a pure content change, not a code
change (see `OverworldScene.js` / `BattleScene.js`'s texture-generation
functions).

**Spaced repetition (FSRS):** implemented via the [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) library (`game/src/scheduler.js`). Each concept has a real FSRS card (difficulty, stability, due date) persisted to `localStorage`. A monster only appears on the overworld map once its concept is due; answering it -- right or wrong -- reschedules it via FSRS and it disappears until it's next due (a wrong answer still costs a heart, but no longer lets you instantly retry the same monster, since the whole point is real spacing rather than immediate re-drilling). The HUD shows "Due now: X / Y"; when nothing's due it shows "All caught up! Next review due in ...".

## What's next (deliberately not in the MVP)

- **Video/lecture ingestion (Whisper):** pipeline only handles `.pptx`
  today.
- **Multi-question battles / boss fights / Zelda-style item gating:**
  right now one battle = one question. The full design layers a
  Zelda-style overworld with regions-per-unit and mastery-gated boss
  fights on top of this same battle loop.
- **Real art/audio pass, review-queue UI:** the review queue is
  currently just a JSON file (`pipeline/output/review_queue.json`), not
  a page you can click through.
- **Known rough edge:** the near-duplicate check in `validate.py`
  compares full question text, and every mock-generated question shares
  the same "Which statement about X is true?" template -- so it can
  false-positive on short titles (this is what happened to the sample
  deck's Mars question, which got flagged for review even though it was
  fine). Worth tightening once real LLM-generated questions replace the
  templated mock ones.

## Cost

Hosting the finished game costs nothing (it's static files -- Cloudflare
Pages / GitHub Pages free tier). The only real per-use cost is the LLM
calls in the pipeline's real mode, which run to a few cents per deck
using a small/cheap model -- see the full build plan for the numbers.
Nothing in this MVP has spent any money or required an account signup.
