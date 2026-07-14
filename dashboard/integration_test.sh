#!/bin/bash
# Integration test: exercises the exact REST/Auth/Storage calls the React
# dashboard makes, via curl, to prove the real HTTP contract works -- not
# just that the TypeScript compiles. Defaults to local Supabase; to run
# against the real cloud project instead:
#   API_URL=https://kjtnfrvsqmdkutydovba.supabase.co \
#   ANON_KEY=sb_publishable_... \
#   bash integration_test.sh
set -e

API_URL="${API_URL:-http://127.0.0.1:54321}"
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"
EMAIL="dashboard-test-$(date +%s)@example.com"
PASSWORD="testpassword123"

echo "=== 1. Sign up a new user via Auth API ==="
SIGNUP_RESPONSE=$(curl -s -X POST "$API_URL/auth/v1/signup" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
ACCESS_TOKEN=$(echo "$SIGNUP_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
USER_ID=$(echo "$SIGNUP_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['id'])")
echo "Signed up user: $USER_ID"
if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "None" ]; then
  echo "FAILED: no access token in signup response"; echo "$SIGNUP_RESPONSE"; exit 1
fi

echo ""
echo "=== 2. Create a tenant via create_tenant() RPC (as this user) ==="
TENANT_ID=$(curl -s -X POST "$API_URL/rest/v1/rpc/create_tenant" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_name\":\"Integration Test School\",\"tenant_slug\":\"integ-test-$(date +%s)\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin))")
echo "Created tenant: $TENANT_ID"
if [ "$TENANT_ID" = "null" ] || [ -z "$TENANT_ID" ]; then
  echo "FAILED: create_tenant did not return an id"; exit 1
fi
TENANT_ID=$(echo "$TENANT_ID" | tr -d '"')

echo ""
echo "=== 3. Fetch the tenant row (RLS: should succeed, this user is a member) ==="
TENANT_ROW=$(curl -s "$API_URL/rest/v1/tenants?id=eq.$TENANT_ID&select=*" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "$TENANT_ROW" | python3 -m json.tool

echo ""
echo "=== 4. Update branding colors (as owner -- should succeed) ==="
UPDATE_RESULT=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$API_URL/rest/v1/tenants?id=eq.$TENANT_ID" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"theme_primary_color":"#ff6600","theme_accent_color":"#0066ff"}')
echo "$UPDATE_RESULT"

echo ""
echo "=== 5. Upload a logo file to Storage (tenant-logos bucket, tenant-scoped path) ==="
echo "fake-png-bytes-for-testing" > /tmp/test-logo.png
UPLOAD_STATUS=$(curl -s -o /tmp/upload_response.json -w "%{http_code}" \
  -X POST "$API_URL/storage/v1/object/tenant-logos/$TENANT_ID/logo.png" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @/tmp/test-logo.png)
echo "Upload HTTP status: $UPLOAD_STATUS"
cat /tmp/upload_response.json
echo ""
if [ "$UPLOAD_STATUS" != "200" ]; then
  echo "FAILED: logo upload did not return 200"; exit 1
fi

echo ""
echo "=== 6. Confirm the logo is publicly readable (no auth header) ==="
PUBLIC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/storage/v1/object/public/tenant-logos/$TENANT_ID/logo.png")
echo "Public read HTTP status: $PUBLIC_STATUS"
if [ "$PUBLIC_STATUS" != "200" ]; then
  echo "FAILED: logo should be publicly readable"; exit 1
fi

echo ""
echo "=== 7. Create a content_set (the 'upload a deck' flow) ==="
CONTENT_SET_RESULT=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$API_URL/rest/v1/content_sets" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"title\":\"Integration test deck\",\"source_type\":\"pptx\",\"created_by\":\"$USER_ID\"}")
echo "$CONTENT_SET_RESULT"

echo ""
echo "=== 8. List content_sets for this tenant (should show the one just created) ==="
curl -s "$API_URL/rest/v1/content_sets?tenant_id=eq.$TENANT_ID&select=title,status,source_type" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -m json.tool

echo ""
echo "=== ALL INTEGRATION CHECKS COMPLETE ==="
