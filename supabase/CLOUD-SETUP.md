# Setting up the real (cloud) Supabase project

Everything so far (the database schema, the dashboard app) has been built
and tested against a **local** copy of Supabase running in Docker on this
Mac -- that's free and needed no account. Making the dashboard usable by
anyone other than someone sitting at this specific Mac requires a real,
cloud-hosted project. This doc is the exact steps for that -- written so
you can do it yourself in Terminal, same as the Anthropic/OpenAI key
setup earlier in this project.

## Step 1 -- Create a Supabase account and project

1. On any device, go to **https://supabase.com/dashboard** and sign up
   (or sign in) -- email or GitHub. Free tier, no card required to start.
2. Click **New Project**. Pick an organization (create one if it's your
   first project), give the project a name (e.g. "retro-learning-game"),
   set a database password (**save this somewhere** -- you'll need it
   once in Step 3, and it's not the same as your Supabase account
   password), and pick a region (closest to where most users will be).
3. Wait for the project to finish provisioning (a minute or two).

## Step 2 -- Get the project's API keys

1. In the project dashboard, go to **Project Settings -> API**.
2. You'll see a **Project URL** (looks like `https://xxxxx.supabase.co`)
   and an **anon / public** key (a long string starting with `eyJ...`).
   Copy both -- you'll paste them into a file in Step 4.
3. There's also a **service_role** key on that same page. **Do not use
   this one for the dashboard app** -- it bypasses all the security rules
   (RLS) this project relies on. It's only for a future server-side
   component that doesn't exist yet. Leave it alone for now.

## Step 3 -- Link this Mac's copy of the project and push the database schema

This step needs the Supabase CLI to be logged in to your *account*
(separate from the project's own database password from Step 1) --
found this out by actually trying it, not by guessing, so it's worth
doing exactly this way rather than the interactive `supabase link` flow,
which opens a browser login that can hang if nobody's there to click
"Allow."

1. Go to **https://supabase.com/dashboard/account/tokens**, click
   **Generate new token**, name it anything (e.g. "retro-learning-game
   cli"), and copy the token it shows you (starts with `sbp_...`) --
   shown only once. No billing involved, this is a free account feature.
2. Open **Terminal** and run:
   ```bash
   cd /Users/minione/retro-learning-game
   export SUPABASE_ACCESS_TOKEN=sbp_...the token from step 1...
   supabase link --project-ref kjtnfrvsqmdkutydovba
   supabase db push
   ```
   `db push` may additionally ask for the database password you set in
   Step 1 (a separate thing from the access token) -- have it ready.

This applies the same schema/security-rules file (`supabase/migrations/`)
that's already been tested locally to the real cloud project. You should
see `Applying migration 20260714034100_initial_schema.sql...` and then a
success message.

**Verify it worked:** go back to the Supabase dashboard in your browser,
click **Table Editor** in the left sidebar. You should see tables named
`tenants`, `memberships`, `content_sets`, `concepts`, and `fsrs_cards`.

## Step 4 -- Point the dashboard app at the real project

Back in Terminal:

```bash
cd /Users/minione/retro-learning-game/dashboard
nano .env
```

Replace both lines with the values from Step 2 (not the local ones that
were there before):

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...the anon key from Step 2...
```

Save and exit: **Control+O**, then **Enter**, then **Control+X**.

**Verify it worked:** run `npm run dev` in that same `dashboard` folder,
open the URL it prints, and try signing up with an email address. If you
land on "Create your organization" afterward, it's talking to the real
cloud project correctly.

## Step 5 (optional, can be done later) -- Enable Google sign-in

Email sign-in already works with no further setup. Google sign-in needs
a one-time setup in two places that have to reference each other, so do
them in this order:

1. Go to **https://console.cloud.google.com/apis/credentials** (sign in
   with any Google account -- doesn't need to be a paid/business
   account). Create a project if you don't have one, then click **Create
   Credentials -> OAuth client ID**. If prompted to configure a "consent
   screen" first, choose **External**, fill in just the required fields
   (app name, your email), and save.
2. For the OAuth client itself, choose **Web application**. You'll need
   a "redirect URI" from Supabase before you can finish this -- open a
   second browser tab to your Supabase project -> **Authentication ->
   Providers -> Google**, and copy the **Callback URL (for OAuth)** shown
   there (looks like `https://xxxxx.supabase.co/auth/v1/callback`).
   Paste that into the Google Cloud form's **Authorized redirect URIs**.
3. Google will show you a **Client ID** and **Client Secret**. Copy both
   back into the Supabase **Authentication -> Providers -> Google** page,
   toggle it **Enabled**, and save.

**Verify it worked:** reload the dashboard app, click "Sign in with
Google" on the login page, and confirm it takes you through a real
Google account picker rather than an error page.

## What NOT to do

- Don't put the `service_role` key in `dashboard/.env` or anywhere in the
  `dashboard/` or `game/` folders -- those get bundled into files a
  browser downloads, and that key bypasses every security rule in the
  database.
- Don't commit `dashboard/.env` -- it's already gitignored, but worth
  double-checking with `git status` if anything looks off.
