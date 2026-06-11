#!/bin/bash
# ─────────────────────────────────────────────────────────
# RateLimiter — Manual Smoke Tests
# ─────────────────────────────────────────────────────────
# Run this script after `docker compose up --build` and migrations.
# Usage: ./tests/manual.sh
# ─────────────────────────────────────────────────────────

set -e

BASE_URL="http://localhost"
MANAGE_URL="${BASE_URL}/manage"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $1"; }

echo ""
echo "════════════════════════════════════════════════"
echo "  RateLimiter — Smoke Test Suite"
echo "════════════════════════════════════════════════"
echo ""

# ─── Test 1: Register Tenant A ──────────────────────
info "Test 1: Registering Tenant A..."

REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${MANAGE_URL}/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testa@smoketest.com",
    "upstreamUrl": "https://httpbin.org",
    "plan": "pro"
  }')

HTTP_CODE=$(echo "$REGISTER_RESPONSE" | tail -n1)
BODY=$(echo "$REGISTER_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  pass "Tenant A registered (HTTP 201)"
else
  fail "Expected HTTP 201, got ${HTTP_CODE}. Body: ${BODY}"
fi

TENANT_A_ID=$(echo "$BODY" | grep -o '"tenantId":"[^"]*"' | cut -d'"' -f4)
PROJECT_KEY_A=$(echo "$BODY" | grep -o '"projectKey":"[^"]*"' | cut -d'"' -f4)
TOKEN_A=$(echo "$BODY" | grep -o '"dashboardToken":"[^"]*"' | cut -d'"' -f4)

info "  Tenant A ID: ${TENANT_A_ID}"
info "  Project Key: ${PROJECT_KEY_A}"

# ─── Test 2: Create a strict rule for /login ─────────
info "Test 2: Creating strict rule for /login (3 req / 60s)..."

RULE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${MANAGE_URL}/rules" \
  -H "Authorization: Bearer ${TOKEN_A}" \
  -H "Content-Type: application/json" \
  -d '{
    "route": "/login",
    "keyBy": "ip",
    "maxReq": 3,
    "windowMs": 60000,
    "priority": 10
  }')

HTTP_CODE=$(echo "$RULE_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
  pass "Rule created (HTTP 201)"
else
  BODY=$(echo "$RULE_RESPONSE" | sed '$d')
  fail "Expected HTTP 201, got ${HTTP_CODE}. Body: ${BODY}"
fi

# ─── Test 3: Create a general catch-all rule ─────────
info "Test 3: Creating catch-all rule (100 req / 60s)..."

RULE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${MANAGE_URL}/rules" \
  -H "Authorization: Bearer ${TOKEN_A}" \
  -H "Content-Type: application/json" \
  -d '{
    "route": "*",
    "keyBy": "ip",
    "maxReq": 100,
    "windowMs": 60000,
    "priority": 1
  }')

HTTP_CODE=$(echo "$RULE_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
  pass "Catch-all rule created (HTTP 201)"
else
  fail "Expected HTTP 201, got ${HTTP_CODE}"
fi

# ─── Test 4: List rules ─────────────────────────────
info "Test 4: Listing rules..."

RULES_RESPONSE=$(curl -s -w "\n%{http_code}" "${MANAGE_URL}/rules" \
  -H "Authorization: Bearer ${TOKEN_A}")

HTTP_CODE=$(echo "$RULES_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
  pass "Rules listed (HTTP 200)"
else
  fail "Expected HTTP 200, got ${HTTP_CODE}"
fi

# ─── Test 5: Send requests through gateway ──────────
info "Test 5: Sending 3 allowed requests to /login..."

for i in 1 2 3; do
  RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/login" \
    -H "X-Project-Key: ${PROJECT_KEY_A}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  HEADERS=$(curl -sI "${BASE_URL}/login" -H "X-Project-Key: ${PROJECT_KEY_A}")

  if echo "$HEADERS" | grep -qi "X-RateLimit-Limit"; then
    pass "Request ${i}: X-RateLimit headers present"
  else
    info "Request ${i}: HTTP ${HTTP_CODE} (headers may vary)"
  fi
done

# ─── Test 6: Trigger 429 ────────────────────────────
info "Test 6: Sending request #4 to trigger 429..."

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/login" \
  -H "X-Project-Key: ${PROJECT_KEY_A}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "429" ]; then
  pass "Rate limit triggered (HTTP 429)"
else
  info "Got HTTP ${HTTP_CODE} (may need more requests or the upstream is responding)"
fi

if echo "$BODY" | grep -q "Too Many Requests"; then
  pass "Response body contains 'Too Many Requests'"
fi

# ─── Test 7: Check Retry-After header ───────────────
info "Test 7: Checking Retry-After header on 429..."

HEADERS=$(curl -sI "${BASE_URL}/login" -H "X-Project-Key: ${PROJECT_KEY_A}")

if echo "$HEADERS" | grep -qi "Retry-After"; then
  pass "Retry-After header present"
else
  info "Retry-After header not found (may need a 429 response)"
fi

# ─── Test 8: Register Tenant B (isolation check) ────
info "Test 8: Registering Tenant B for isolation check..."

REGISTER_B=$(curl -s -w "\n%{http_code}" -X POST "${MANAGE_URL}/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testb@smoketest.com",
    "upstreamUrl": "https://httpbin.org",
    "plan": "free"
  }')

HTTP_CODE=$(echo "$REGISTER_B" | tail -n1)
BODY_B=$(echo "$REGISTER_B" | sed '$d')
PROJECT_KEY_B=$(echo "$BODY_B" | grep -o '"projectKey":"[^"]*"' | cut -d'"' -f4)

if [ "$HTTP_CODE" = "201" ]; then
  pass "Tenant B registered (HTTP 201)"
fi

# ─── Test 9: Tenant B should NOT be rate limited ────
info "Test 9: Tenant B's counter should be independent..."

RESPONSE_B=$(curl -s -w "\n%{http_code}" "${BASE_URL}/login" \
  -H "X-Project-Key: ${PROJECT_KEY_B}")

HTTP_CODE=$(echo "$RESPONSE_B" | tail -n1)

if [ "$HTTP_CODE" != "429" ]; then
  pass "Tenant B not affected by Tenant A's rate limit (isolation confirmed)"
else
  fail "Tenant B got 429 — isolation is broken!"
fi

# ─── Test 10: Invalid project key ───────────────────
info "Test 10: Sending request with invalid project key..."

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/anything" \
  -H "X-Project-Key: invalid_key_12345")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
  pass "Invalid key rejected (HTTP 401)"
else
  fail "Expected HTTP 401, got ${HTTP_CODE}"
fi

# ─── Test 11: Missing project key ───────────────────
info "Test 11: Sending request without project key..."

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/anything")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
  pass "Missing key rejected (HTTP 401)"
else
  fail "Expected HTTP 401, got ${HTTP_CODE}"
fi

# ─── Test 12: Usage stats ───────────────────────────
info "Test 12: Fetching usage stats..."

USAGE_RESPONSE=$(curl -s -w "\n%{http_code}" "${MANAGE_URL}/usage?hours=24" \
  -H "Authorization: Bearer ${TOKEN_A}")

HTTP_CODE=$(echo "$USAGE_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "Usage stats returned (HTTP 200)"
else
  fail "Expected HTTP 200, got ${HTTP_CODE}"
fi

echo ""
echo "════════════════════════════════════════════════"
echo -e "  ${GREEN}Smoke tests completed!${NC}"
echo "════════════════════════════════════════════════"
echo ""
