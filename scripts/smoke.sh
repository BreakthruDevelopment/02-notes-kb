#!/usr/bin/env bash
# End-to-end smoke test against a running app (local, CI, or a deployed URL).
# Signs up two users over HTTP and checks the sign-in gate (full notes flow arrives with the notes API).
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

echo "SMOKE PASS"
