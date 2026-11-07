#!/usr/bin/env bash
# End-to-end smoke test against a running app (local, CI, or a deployed URL).
# Signs up two users over HTTP and checks the sign-in gate and the main notes flow.
#   BASE_URL=https://app7.breakthruventures.ai ./scripts/smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
RUN_ID="$(date +%s)$RANDOM"
JAR_A="$(mktemp)"; JAR_B="$(mktemp)"
trap 'rm -f "$JAR_A" "$JAR_B"' EXIT

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "ok - $*"; }

health=$(curl -fsS "$BASE_URL/api/health") || fail "health endpoint unreachable"
echo "$health" | grep -q '"status":"ok"' || fail "health not ok: $health"
pass "health check"

signup() {
  local jar=$1 email=$2
  curl -fsS -c "$jar" -b "$jar" -H 'content-type: application/json' -H "origin: $BASE_URL" \
    -d "{\"email\":\"$email\",\"password\":\"smoke-test-password-1\",\"name\":\"Smoke\"}" \
    "$BASE_URL/api/auth/sign-up/email" >/dev/null || fail "sign-up failed for $email"
}

signup "$JAR_A" "smoke-a-$RUN_ID@example.test"
signup "$JAR_B" "smoke-b-$RUN_ID@example.test"
pass "two users signed up"

# Notes API arrives in a later issue; until then prove the signed-in page gate works.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/notes")
[ "$code" = "307" ] || fail "anonymous /notes should redirect to sign-in, got $code"
pass "anonymous access refused"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "$BASE_URL/notes")
[ "$code" = "200" ] || fail "signed-in /notes should be 200, got $code"
pass "signed-in user reaches /notes"

# Notes flow: private note is 404 to another user until shared; a read share can't edit.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/notes")
[ "$code" = "401" ] || fail "anonymous GET /api/notes should be 401, got $code"
pass "anonymous API access refused"

JSON=(-H 'content-type: application/json' -H "origin: $BASE_URL")
created=$(curl -fsS -b "$JAR_A" "${JSON[@]}" -d '{"title":"Smoke note","body":"private body"}' "$BASE_URL/api/notes") || fail "A could not create a note"
NOTE_ID=$(echo "$created" | sed -n 's/.*"id":"\([0-9a-f-]*\)".*/\1/p' | head -1)
UPDATED_AT=$(echo "$created" | sed -n 's/.*"updatedAt":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$NOTE_ID" ] && [ -n "$UPDATED_AT" ] || fail "could not parse created note: $created"
pass "A created a private note"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" "$BASE_URL/api/notes/$NOTE_ID")
[ "$code" = "404" ] || fail "B should get 404 on A's private note, got $code"
pass "private note is 404 to another user"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "${JSON[@]}" -X PUT \
  -d "{\"email\":\"smoke-b-$RUN_ID@example.test\",\"permission\":\"read\"}" "$BASE_URL/api/notes/$NOTE_ID/shares")
[ "$code" = "200" ] || fail "A sharing with B should be 200, got $code"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" "$BASE_URL/api/notes/$NOTE_ID")
[ "$code" = "200" ] || fail "B should read the shared note, got $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" "${JSON[@]}" -X PATCH \
  -d "{\"title\":\"Hijacked\",\"updatedAt\":\"$UPDATED_AT\"}" "$BASE_URL/api/notes/$NOTE_ID")
[ "$code" = "403" ] || fail "read share PATCH should be 403, got $code"
pass "read share can read but not edit"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "${JSON[@]}" -X PATCH \
  -d "{\"title\":\"Edited\",\"updatedAt\":\"1999-01-01T00:00:00.000Z\"}" "$BASE_URL/api/notes/$NOTE_ID")
[ "$code" = "409" ] || fail "stale updatedAt should be 409, got $code"
pass "stale update is 409"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" -H "origin: https://evil.example" -X DELETE "$BASE_URL/api/notes/$NOTE_ID")
[ "$code" = "403" ] || fail "cross-origin DELETE should be 403, got $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "${JSON[@]}" -X DELETE "$BASE_URL/api/notes/$NOTE_ID")
[ "$code" = "204" ] || fail "owner DELETE should be 204, got $code"
pass "cross-origin delete refused, owner delete works"

echo "SMOKE PASS"
