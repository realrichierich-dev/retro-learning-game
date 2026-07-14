-- Phase 1 foundation schema: tenants, memberships, content pipeline data,
-- and per-user FSRS state, all scoped by tenant_id with Row-Level Security.
--
-- Multi-tenancy model: shared tables, every tenant-owned row carries a
-- tenant_id column, RLS policies restrict every read/write to tenants the
-- calling user belongs to (per memberships). This is the standard,
-- cost-effective pattern documented in PLATFORM-ROADMAP.md Section 3 --
-- not per-tenant schemas or databases.
--
-- RLS recursion note: policies on `memberships` can't simply query
-- `memberships` again to check "does this user belong to this tenant" --
-- that's self-referential and either recurses or requires disabling RLS
-- for the check, which defeats the point. The standard fix (used
-- throughout this file) is a couple of `security definer` helper
-- functions that look up membership once, then every policy -- including
-- the one on `memberships` itself -- calls the helper instead of querying
-- the table directly.

create extension if not exists pgcrypto;

-- ============================================================
-- Tables
-- ============================================================

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  theme_primary_color text not null default '#7ee787',
  theme_accent_color text not null default '#58a6ff',
  theme_bg_color text not null default '#0f0f1a',
  -- Abuse/cost-capping default (see PLATFORM-ROADMAP.md decision #3):
  -- free/school tier gets 5 content-set generations/month, paid tier 50.
  -- Enforced below in can_create_content_set(), not just a UI suggestion.
  -- These numbers are placeholders Rich should revisit once real pricing
  -- tiers exist -- not treated as final here.
  plan_tier text not null default 'free' check (plan_tier in ('free', 'paid')),
  monthly_generation_limit int not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table public.content_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('pptx', 'video', 'txt')),
  source_storage_path text,
  -- Job status for the (not-yet-built -- see README) async pipeline
  -- runner: a row lands here as 'pending' the moment a file is uploaded;
  -- this migration only creates the row and the storage object, it does
  -- not itself run ingest_pptx.py/generate_concepts.py/validate.py.
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- The DB version of pipeline/schema.py's concept shape. question/validation
-- kept as jsonb rather than fully normalized columns since their shape is
-- already a stable, tested contract (see schema.py's REQUIRED_*_FIELDS) --
-- normalizing further here would just duplicate that contract in SQL for
-- no real benefit at this scale.
create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_set_id uuid not null references public.content_sets(id) on delete cascade,
  title text not null,
  tags text[] not null default '{}',
  difficulty text not null default 'medium',
  dialogue text not null default '',
  source_span text not null default '',
  question jsonb not null,
  validation jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Per-user, per-concept FSRS scheduling state -- the server-side source of
-- truth that game/src/scheduler.js's localStorage-only model needs to grow
-- a sync layer on top of (see PLATFORM-ROADMAP.md Section 2). Column names
-- deliberately mirror the ts-fsrs Card shape scheduler.js already uses.
create table public.fsrs_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  difficulty numeric not null default 0,
  stability numeric not null default 0,
  due timestamptz not null default now(),
  elapsed_days int not null default 0,
  scheduled_days int not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  state int not null default 0,
  last_review timestamptz,
  learning_steps int not null default 0,
  unique (user_id, concept_id)
);

create index on public.memberships (user_id);
create index on public.memberships (tenant_id);
create index on public.content_sets (tenant_id);
create index on public.concepts (tenant_id);
create index on public.concepts (content_set_id);
create index on public.fsrs_cards (user_id);
create index on public.fsrs_cards (tenant_id, concept_id);

-- ============================================================
-- Helper functions (security definer -- see recursion note above)
-- ============================================================

create or replace function public.auth_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from public.memberships where user_id = auth.uid();
$$;

create or replace function public.is_tenant_admin(check_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where tenant_id = check_tenant_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.can_create_content_set(check_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    select count(*) from public.content_sets
    where tenant_id = check_tenant_id
      and created_at >= date_trunc('month', now())
  ) < (
    select monthly_generation_limit from public.tenants where id = check_tenant_id
  );
$$;

-- Atomic tenant-creation path: a bare INSERT policy on `tenants` would let
-- any signed-in user create tenant rows freely, which is fine, but the
-- owner membership also needs to be created in the same transaction, and
-- that's easiest to guarantee correctly through one function rather than
-- two separate client-side inserts that could fail halfway.
create or replace function public.create_tenant(tenant_name text, tenant_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (name, slug) values (tenant_name, tenant_slug)
  returning id into new_tenant_id;

  insert into public.memberships (tenant_id, user_id, role)
  values (new_tenant_id, auth.uid(), 'owner');

  return new_tenant_id;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- ============================================================
-- Baseline grants
-- ============================================================
-- RLS policies only narrow what a role can already do -- they don't grant
-- anything by themselves. Without these, `authenticated` has zero table
-- privileges and every query fails with "permission denied" regardless of
-- what the RLS policies below say. This is a real, easy-to-miss step, not
-- boilerplate: found by testing (see supabase/RLS-TESTING.md), not assumed.

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.content_sets to authenticated;
grant select on public.concepts to authenticated;
grant select, insert, update, delete on public.fsrs_cards to authenticated;
grant execute on function public.create_tenant(text, text) to authenticated;

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.content_sets enable row level security;
alter table public.concepts enable row level security;
alter table public.fsrs_cards enable row level security;

-- tenants: members can read their own tenant's row (for branding/plan
-- info); only admins/owners can update it (branding settings page).
-- No direct client INSERT policy -- creation only goes through
-- create_tenant() above.
create policy "members can view their tenant"
  on public.tenants for select
  using (id in (select auth_tenant_ids()));

create policy "tenant admins can update their tenant"
  on public.tenants for update
  using (is_tenant_admin(id));

-- memberships: members can see who else is in their tenant(s); only
-- admins/owners can add, change roles for, or remove members. (Client-side
-- self-service tenant creation goes through create_tenant(), which is
-- security definer and bypasses these policies for its own insert -- this
-- policy exists for a future "invite a teammate" flow.)
create policy "members can view memberships in their tenants"
  on public.memberships for select
  using (tenant_id in (select auth_tenant_ids()));

create policy "tenant admins can add members"
  on public.memberships for insert
  with check (is_tenant_admin(tenant_id));

create policy "tenant admins can update memberships"
  on public.memberships for update
  using (is_tenant_admin(tenant_id));

create policy "tenant admins can remove memberships"
  on public.memberships for delete
  using (is_tenant_admin(tenant_id));

-- content_sets: any member can view their tenant's uploads; any member can
-- create one, gated by the monthly usage cap (not just admins -- a teacher
-- or an individual course creator uploading their own deck is the common
-- case, not just an org admin).
create policy "members can view their tenant's content sets"
  on public.content_sets for select
  using (tenant_id in (select auth_tenant_ids()));

create policy "members can create content sets within their usage cap"
  on public.content_sets for insert
  with check (
    tenant_id in (select auth_tenant_ids())
    and can_create_content_set(tenant_id)
  );

-- concepts: read-only from the client for now. Rows get written by the
-- pipeline job runner (server-side / service-role), which doesn't exist
-- yet -- see README "What's not built yet". No client INSERT policy.
create policy "members can view their tenant's concepts"
  on public.concepts for select
  using (tenant_id in (select auth_tenant_ids()));

-- fsrs_cards: strictly per-user, not just per-tenant -- two teammates in
-- the same org have independent progress on the same concepts.
create policy "users can view their own fsrs cards"
  on public.fsrs_cards for select
  using (user_id = auth.uid());

create policy "users can create their own fsrs cards"
  on public.fsrs_cards for insert
  with check (user_id = auth.uid() and tenant_id in (select auth_tenant_ids()));

create policy "users can update their own fsrs cards"
  on public.fsrs_cards for update
  using (user_id = auth.uid());

-- ============================================================
-- Storage buckets + policies
-- ============================================================
-- Convention: every object path starts with the owning tenant's id as the
-- first folder segment, e.g. "{tenant_id}/logo.png" or
-- "{tenant_id}/decks/{content_set_id}.pptx". Policies check that segment
-- against the caller's tenant memberships via storage.foldername().

insert into storage.buckets (id, name, public)
values ('tenant-logos', 'tenant-logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('tenant-uploads', 'tenant-uploads', false)
on conflict (id) do nothing;

create policy "tenant members can upload their tenant's logo"
  on storage.objects for insert
  with check (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1]::uuid in (select public.auth_tenant_ids())
  );

create policy "tenant members can replace their tenant's logo"
  on storage.objects for update
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1]::uuid in (select public.auth_tenant_ids())
  );

create policy "logos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'tenant-logos');

create policy "tenant members can upload their tenant's content"
  on storage.objects for insert
  with check (
    bucket_id = 'tenant-uploads'
    and (storage.foldername(name))[1]::uuid in (select public.auth_tenant_ids())
  );

create policy "tenant members can read their tenant's uploaded content"
  on storage.objects for select
  using (
    bucket_id = 'tenant-uploads'
    and (storage.foldername(name))[1]::uuid in (select public.auth_tenant_ids())
  );
