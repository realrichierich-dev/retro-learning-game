-- RLS verification script. Not part of the app -- run manually against
-- local Supabase to prove tenant isolation actually holds before trusting
-- the migration.

\set ON_ERROR_STOP off

-- Two fake users, as the postgres superuser (RLS doesn't apply here, and
-- shouldn't -- this is just seeding test fixtures).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@tenant-a.test', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@tenant-b.test', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false);

\echo '=== TEST 1: Alice creates Tenant A via create_tenant() ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.create_tenant('Tenant A School', 'tenant-a') as tenant_a_id \gset
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 2: Bob creates Tenant B via create_tenant() ==='
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.create_tenant('Tenant B Corp', 'tenant-b') as tenant_b_id \gset
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 3: Alice can see exactly her own tenant (expect 1 row: Tenant A School) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select name, slug from public.tenants;
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 4: Bob can see exactly his own tenant (expect 1 row: Tenant B Corp) ==='
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select name, slug from public.tenants;
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 5: Alice tries to create a content_set under Bobs tenant_id (expect: 0 rows inserted, RLS blocks it) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.content_sets (tenant_id, title, source_type, created_by)
values (:'tenant_b_id', 'Sneaky cross-tenant upload', 'pptx', '11111111-1111-1111-1111-111111111111');
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 6: Alice creates a legit content_set under her own tenant (expect: success) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.content_sets (tenant_id, title, source_type, created_by)
values (:'tenant_a_id', 'Alices real deck', 'pptx', '11111111-1111-1111-1111-111111111111')
returning id, title;
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 7: Bob cannot see Alices content_sets (expect 0 rows) ==='
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select title from public.content_sets;
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 8: usage cap -- Alice creates 4 more content_sets (total 5, at the free-tier limit) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.content_sets (tenant_id, title, source_type, created_by)
select :'tenant_a_id', 'Deck ' || g, 'pptx', '11111111-1111-1111-1111-111111111111'
from generate_series(2, 5) g;
select count(*) as total_content_sets_for_tenant_a from public.content_sets where tenant_id = :'tenant_a_id';
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 9: 6th content_set this month should be BLOCKED by the usage cap (expect: 0 rows, policy violation) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.content_sets (tenant_id, title, source_type, created_by)
values (:'tenant_a_id', 'Deck 6 -- should be blocked', 'pptx', '11111111-1111-1111-1111-111111111111');
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 10: fsrs_cards -- Alice and Bob cannot see each others review progress even with same concept_id ==='
-- concepts has no client INSERT grant by design (see migration comment --
-- rows are meant to be written server-side by the future job runner), so
-- seed this one as postgres, same as the pipeline job runner eventually will.
insert into public.concepts (tenant_id, content_set_id, title, question)
select :'tenant_a_id', id, 'Test concept', '{"prompt":"q","options":["a","b","c","d"],"correct_index":0}'::jsonb
from public.content_sets where tenant_id = :'tenant_a_id' limit 1
returning id as concept_id \gset

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.fsrs_cards (tenant_id, user_id, concept_id)
values (:'tenant_a_id', '11111111-1111-1111-1111-111111111111', :'concept_id');
select count(*) as alice_sees_this_many_cards from public.fsrs_cards;
reset role;
reset request.jwt.claim.sub;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as bob_sees_this_many_of_alices_cards from public.fsrs_cards;
reset role;
reset request.jwt.claim.sub;

\echo '=== TEST 11: membership visibility -- Bob cannot see Tenant A memberships ==='
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as bob_sees_this_many_tenant_a_memberships from public.memberships where tenant_id = :'tenant_a_id';
reset role;
reset request.jwt.claim.sub;

\echo '=== ALL TESTS COMPLETE ==='
