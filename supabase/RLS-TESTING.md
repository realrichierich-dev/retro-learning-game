# RLS verification

`rls_test.sql` in this directory is a manual test script that proves tenant
isolation actually holds -- not just that the policies look right on
paper. It creates two fake users/tenants (Alice/Tenant A, Bob/Tenant B),
then runs each query *as* that user (via Postgres session variables that
`auth.uid()` reads, the same mechanism Supabase's real API layer uses) to
prove cross-tenant reads/writes are actually rejected by RLS, not just
absent from the app's UI.

## How to run it

Requires local Supabase running (`supabase start`) and Docker/colima up.

```bash
supabase db reset   # clean slate, reapplies migrations
docker exec -i supabase_db_retro-learning-game psql -U postgres -d postgres < supabase/rls_test.sql
```

## What it proved (last run, all 11 tests passed)

1. A user can create a tenant via `create_tenant()` and becomes its owner.
2. Each user sees only their own tenant, not the other's.
3. **A user cannot insert a row under a different tenant's `tenant_id`** --
   this is the core multi-tenancy guarantee, and it's enforced by RLS, not
   application code. (`ERROR: new row violates row-level security policy`)
4. A user can freely read/write within their own tenant.
5. One tenant cannot see another tenant's `content_sets` rows.
6. **The monthly usage cap (`can_create_content_set()`) is actually
   enforced at the database layer** -- 5 inserts succeed, the 6th is
   rejected by RLS in the same request cycle a real upload would use.
7. `fsrs_cards` isolation is per-*user*, not just per-tenant -- two users
   in the same org don't see each other's review progress, even for the
   identical `concept_id`.
8. `memberships` visibility is also tenant-scoped.

## A real bug this caught

The first version of the migration had all the RLS policies right but
**no baseline `GRANT` statements**, so every query from the `authenticated`
role failed with a blunt "permission denied" regardless of what the RLS
policies said. RLS only narrows access a role already has -- it doesn't
grant anything by itself. Running this test suite is what caught it (see
the migration's "Baseline grants" section for the fix); it would not have
been obvious from reading the policies alone.

## What this script doesn't cover

Storage bucket RLS (`tenant-logos` / `tenant-uploads` path-scoped
policies) isn't exercised here, since Storage access goes through the
Storage HTTP API rather than a raw SQL session. Those policies use the
same `auth_tenant_ids()` helper already proven correct above, but the
HTTP-layer wiring gets its real test when the upload feature in the
dashboard app is exercised end-to-end (an actual signed-in user uploading
an actual file), rather than simulated here.
