#!/usr/bin/env bash
# Notes smoke flow against a running app; touches only two new users and their note.
#   BASE_URL=https://app2.breakthruventures.ai pnpm smoke
set -euo pipefail

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "ok - $*"; }

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
RUN_ID="$(date +%s)-$RANDOM-$RANDOM"
EMAIL_A="smoke-a-$RUN_ID@example.test"
EMAIL_B="smoke-b-$RUN_ID@example.test"
WORD="smokeprobe${RUN_ID//-/}"
SMOKE_TMP="$(mktemp -d)" || fail "could not create temporary files"
trap 'rm -rf "$SMOKE_TMP"' EXIT
JAR_A="$SMOKE_TMP/a.cookies"
JAR_B="$SMOKE_TMP/b.cookies"
BODY="$SMOKE_TMP/body"
JSON=(-H 'Content-Type: application/json' -H "Origin: $BASE_URL")

# No redirects or implicit retries: every check after readiness makes one request.
# --disable prevents curl configuration from adding credentials or changing behavior.
request() {
  local method=$1 path=$2
  shift 2
  smoke_code=$(curl --disable --silent --show-error --connect-timeout 10 --max-time 45 \
    -o "$BODY" -w '%{http_code}' -X "$method" "$@" "$BASE_URL$path") \
    || fail "$method $path could not complete"
}

expect_status() {
  local method=$1 path=$2 expected=$3
  shift 3
  request "$method" "$path" "$@"
  [[ "$smoke_code" =~ ^($expected)$ ]] \
    || fail "$method $path expected HTTP $expected, got $smoke_code"
  pass "$method $path ($smoke_code)"
}

# Azure scale-to-zero can take 30+ seconds. One total budget bounds both curl and sleeps.
health_deadline=$((SECONDS + 90))
healthy=false
while (( SECONDS < health_deadline )); do
  remaining=$((health_deadline - SECONDS))
  attempt_timeout=$((remaining < 30 ? remaining : 30))
  connect_timeout=$((remaining < 10 ? remaining : 10))
  if smoke_code=$(curl --disable --silent --show-error --connect-timeout "$connect_timeout" \
      --max-time "$attempt_timeout" -o "$BODY" -w '%{http_code}' "$BASE_URL/api/health") \
    && [[ "$smoke_code" == 200 ]] \
    && node -e 'try { if (JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).status !== "ok") process.exit(1); } catch { process.exit(1); }' "$BODY"; then
    healthy=true
    break
  fi
  remaining=$((health_deadline - SECONDS))
  if (( remaining > 0 )); then sleep "$((remaining < 3 ? remaining : 3))"; fi
done
[[ "$healthy" == true ]] || fail "GET /api/health did not report ok within 90 seconds"
pass "health ready"

for path in / /sign-in; do
  expect_status GET "$path" 200
  grep -Eq '<footer[^>]*>.*href="https://breakthruventures[.]ai/?"' "$BODY" \
    || fail "GET $path is missing the shared footer link to breakthruventures.ai"
done
expect_status GET /api/notes 401
for path in /notes /ask /admin; do
  expect_status GET "$path" '3[0-9][0-9]'
done

signup() {
  local jar=$1 email=$2
  expect_status POST /api/auth/sign-up/email '2[0-9][0-9]' -c "$jar" "${JSON[@]}" \
    -d "{\"email\":\"$email\",\"password\":\"smoke-test-password-$RUN_ID\",\"name\":\"Smoke\"}"
  smoke_user_id=$(node -e '
    try {
      const { user } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      if (!user || user.email !== process.argv[2] || typeof user.id !== "string" || !user.id || (user.role && user.role !== "user")) process.exit(1);
      process.stdout.write(user.id);
    } catch { process.exit(1); }
  ' "$BODY" "$email") || fail "sign-up did not return the fresh non-admin user"
}
signup "$JAR_A" "$EMAIL_A"
USER_A_ID="$smoke_user_id"
signup "$JAR_B" "$EMAIL_B"
[[ "$USER_A_ID" != "$smoke_user_id" ]] || fail "sign-ups did not create distinct users"

# Validate ownership before using any returned id in a mutation. Never parse JSON with sed.
note_fields() {
  local expected_id=${1:-}
  smoke_fields=$(node -e '
    try {
      const { note } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      if (!note || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.id) ||
          note.ownerId !== process.argv[2] || note.visibility !== "private" ||
          (process.argv[3] && note.id !== process.argv[3]) || typeof note.updatedAt !== "string" ||
          !Number.isFinite(Date.parse(note.updatedAt)) || new Date(note.updatedAt).toISOString() !== note.updatedAt) process.exit(1);
      process.stdout.write(`${note.id} ${note.updatedAt}`);
    } catch { process.exit(1); }
  ' "$BODY" "$USER_A_ID" "$expected_id") || fail "response must identify A's private note and a valid updatedAt"
  read -r smoke_note_id smoke_updated_at <<< "$smoke_fields" || fail "could not read note metadata"
}

expect_status POST /api/notes 201 -b "$JAR_A" "${JSON[@]}" \
  -d "{\"title\":\"Smoke note $WORD\",\"body\":\"For $WORD, the verification code is $WORD. This private note records $WORD.\",\"visibility\":\"private\"}"
note_fields
NOTE_ID="$smoke_note_id"
expect_status GET "/api/notes/$NOTE_ID" 404 -b "$JAR_B"
expect_status GET "/notes/$NOTE_ID" 404 -b "$JAR_B"

check_answer() {
  local reader=$1
  node -e '
    try {
      const data = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!data || typeof data.found !== "boolean" || typeof data.answer !== "string" ||
          !["vector", "keyword", "demo"].includes(data.mode) || !Array.isArray(data.citations) ||
          !data.citations.every(c => c && typeof c.noteId === "string" && uuid.test(c.noteId) && typeof c.title === "string")) process.exit(1);
      const citesNote = data.citations.some(c => c.noteId === process.argv[2]);
      if (process.argv[3] === "B" ? citesNote : data.found && !citesNote) process.exit(1);
    } catch { process.exit(1); }
  ' "$BODY" "$NOTE_ID" "$reader" || fail "$reader's Ask response has an invalid shape or violates note citation permissions"
  pass "$reader's Ask response shape and citations"
}
QUESTION="{\"question\":\"What is the verification code recorded for $WORD?\"}"
expect_status POST /api/ask 200 -b "$JAR_B" "${JSON[@]}" -d "$QUESTION"
check_answer B

expect_status PUT "/api/notes/$NOTE_ID/shares" 200 -b "$JAR_A" "${JSON[@]}" \
  -d "{\"email\":\"$EMAIL_B\",\"permission\":\"read\"}"
expect_status GET "/api/notes/$NOTE_ID" 200 -b "$JAR_B"
note_fields "$NOTE_ID"
OLD_UPDATED_AT="$smoke_updated_at"
expect_status PATCH "/api/notes/$NOTE_ID" 403 -b "$JAR_B" "${JSON[@]}" \
  -d "{\"title\":\"Unauthorized edit\",\"updatedAt\":\"$OLD_UPDATED_AT\"}"

expect_status POST /api/ask 200 -b "$JAR_A" "${JSON[@]}" -d "$QUESTION"
check_answer A

expect_status PATCH "/api/notes/$NOTE_ID" 200 -b "$JAR_A" "${JSON[@]}" \
  -d "{\"title\":\"Edited smoke note $WORD\",\"updatedAt\":\"$OLD_UPDATED_AT\"}"
note_fields "$NOTE_ID"
[[ "$smoke_updated_at" != "$OLD_UPDATED_AT" ]] || fail "successful edit did not advance updatedAt"
expect_status PATCH "/api/notes/$NOTE_ID" 409 -b "$JAR_A" "${JSON[@]}" \
  -d "{\"title\":\"Stale edit\",\"updatedAt\":\"$OLD_UPDATED_AT\"}"

expect_status DELETE "/api/notes/$NOTE_ID" 403 -b "$JAR_A" -H 'Origin: https://cross-origin-smoke.invalid'
expect_status DELETE "/api/notes/$NOTE_ID" 204 -b "$JAR_A" "${JSON[@]}"
expect_status GET "/api/notes/$NOTE_ID" 404 -b "$JAR_B"
expect_status GET /admin '3[0-9][0-9]' -b "$JAR_A"
expect_status GET /notes/00000000-0000-0000-0000-000000000000 404 -b "$JAR_A"

echo "SMOKE PASS"
