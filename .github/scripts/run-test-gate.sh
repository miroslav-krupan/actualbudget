#!/usr/bin/env bash
#
# Deterministic test gate with an external fix loop.
#
# The LLM has already implemented and self-verified. This gate is the SOURCE OF
# TRUTH: it runs the tests in the AFFECTED SUBTREE (the directories the change
# touched — not the whole package, which for a large package like
# @actual-app/web is impractically slow) and decides pass/fail from vitest's
# real exit code + the JUnit failure/error counts — never the LLM's word. On
# disagreement it feeds the failure back to the LLM and re-runs, up to
# MAX_GATE_ATTEMPTS (default 3). Evidence from the final run is committed by the
# caller.
#
# Usage: bash run-test-gate.sh <spec_dir> <label>
# Env:   COPILOT_GITHUB_TOKEN (in-loop fix), MAX_GATE_ATTEMPTS (opt).
# Emits to $GITHUB_ENV: TESTS_PASSED, TESTS_TOTAL, TESTS_FAILED, TESTS_PKG,
#         EVIDENCE_DIR. Writes evidence to <spec_dir>/test-evidence/<label>/.

SPEC_DIR="$1"
LABEL="$2"
MAX_ATTEMPTS="${MAX_GATE_ATTEMPTS:-3}"
# Wall-clock cap for each in-loop remediation fix call (seconds). Generous
# headroom over a real fix (~5-6 min) so it never cuts legitimate work — it
# only kills a genuinely hung call. The first implement call is NOT capped.
FIX_TIMEOUT="${GATE_FIX_TIMEOUT:-900}"
OUT="$SPEC_DIR/test-evidence/$LABEL"
mkdir -p "$OUT"
# Absolute paths (vitest runs in the package dir via `exec`, so a relative
# --outputFile would resolve wrong). Robust for relative or absolute SPEC_DIR.
OUT_ABS=$(cd "$OUT" && pwd)
XML="$OUT_ABS/junit.xml"
LOG="$OUT_ABS/console.log"

# Collect the LLM's changed files.
CHANGED=()
while IFS= read -r line; do
  f=$(printf '%s' "$line" | sed 's/^...//; s/^"//; s/"$//')
  [ -n "$f" ] && CHANGED+=("$f")
done < <(git status --porcelain)

# The affected package is the first packages/<pkg> touched.
PKG=""
for f in "${CHANGED[@]}"; do
  case "$f" in packages/*) PKG=$(printf '%s' "$f" | cut -d/ -f1-2); break ;; esac
done
if [ -z "$PKG" ]; then
  echo "::error::Could not determine the affected package from the changes."
  echo "TESTS_PASSED=false" >> "$GITHUB_ENV"
  exit 0
fi
PKG_NAME=$(node -p "require('./$PKG/package.json').name")
ENVV=""
[ "$PKG_NAME" = "@actual-app/core" ] && ENVV="ENV=node"

# Build the test scope: the set of directories (relative to the package) that
# the change touched. vitest runs every test file under those dirs — the new
# tests plus their siblings — giving regression coverage for the touched area
# without running the entire package.
NEW_TESTS=()
SCOPE_SET=""
for f in "${CHANGED[@]}"; do
  case "$f" in "$PKG"/*) ;; *) continue ;; esac
  case "$f" in
    *.test.ts|*.test.tsx|*.test.js|*.spec.ts|*.spec.tsx|*.spec.js) NEW_TESTS+=("$f") ;;
  esac
  rel=${f#"$PKG"/}
  dir=$(dirname "$rel")
  case " $SCOPE_SET " in *" $dir "*) ;; *) SCOPE_SET="$SCOPE_SET $dir" ;; esac
done
SCOPE=$(printf '%s' "$SCOPE_SET" | sed 's/^ *//')
[ -z "$SCOPE" ] && SCOPE="."

echo "Affected package: $PKG ($PKG_NAME)"
echo "Test scope: $SCOPE"
echo "New test files: ${NEW_TESTS[*]:-none}"

# Run the scoped tests; sets RC, TOTAL, FAILS, ERRS.
run_suite() {
  # shellcheck disable=SC2086
  yarn workspace "$PKG_NAME" exec env $ENVV vitest run $SCOPE \
    --reporter=junit --outputFile="$XML" > "$LOG" 2>&1
  RC=$?
  local counts
  counts=$(node -e '
    const fs=require("fs");
    try {
      const s=fs.readFileSync(process.argv[1],"utf8");
      const m=s.match(/<testsuites\b[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"[^>]*\berrors="(\d+)"/);
      // -1 signals "could not parse" — used for display only, never the verdict.
      console.log(m ? `${m[1]} ${m[2]} ${m[3]}` : "-1 -1 -1");
    } catch(e){ console.log("-1 -1 -1"); }
  ' "$XML")
  TOTAL=$(printf '%s' "$counts" | awk '{print $1}')
  FAILS=$(printf '%s' "$counts" | awk '{print $2}')
  ERRS=$(printf '%s' "$counts" | awk '{print $3}')
}

VERDICT=false
attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "== Gate attempt $attempt/$MAX_ATTEMPTS =="
  run_suite
  echo "vitest exit=$RC tests=$TOTAL failures=$FAILS errors=$ERRS"
  # vitest's exit code is the source of truth: it exits non-zero on any test
  # failure, error, or no-tests-found. The parsed counts are for display only
  # and must NEVER override a green exit (a parse hiccup used to fake a failure
  # and trigger a pointless fix loop).
  if [ "$RC" -eq 0 ]; then
    VERDICT=true
    break
  fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "Gate failed; asking the LLM to fix (timeout ${FIX_TIMEOUT}s) and re-running."
    FAILTAIL=$(tail -80 "$LOG")
    if ! timeout "$FIX_TIMEOUT" copilot --allow-all-tools -p "The deterministic \
    test run for package ${PKG_NAME} (scope: ${SCOPE}) failed, even though you \
    reported it green. Fix the code or the tests so these tests pass. Do not \
    weaken or delete tests to force a pass, and do NOT run git or gh. Failing \
    output (tail):

    ${FAILTAIL}"; then
      echo "Fix call timed out or errored; re-running the gate anyway."
    fi
  fi
  attempt=$((attempt + 1))
done

# Human-readable totals. If the XML could not be parsed (TOTAL<0) but vitest
# passed, say so instead of printing bogus numbers.
if [ "$TOTAL" -ge 0 ] 2>/dev/null; then
  PASSED=$(( TOTAL - FAILS - ERRS ))
  TOTALS_LINE="$PASSED passed, $FAILS failed, $ERRS errors (of $TOTAL)"
  TOTAL_ENV=$TOTAL
  FAILED_ENV=$(( FAILS + ERRS ))
else
  PASSED="?"
  TOTALS_LINE="counts unavailable (JUnit XML unparsed); verdict from vitest exit code $RC"
  TOTAL_ENV=0
  FAILED_ENV=$([ "$VERDICT" = true ] && echo 0 || echo 1)
fi

NEW_LIST=$(node -e '
const fs=require("fs");
try {
  const xml=fs.readFileSync(process.argv[1],"utf8");
  const news=process.argv.slice(2);
  const out=[];
  const re=/<testcase\b[^>]*\bclassname="([^"]*)"[^>]*\bname="([^"]*)"/g;
  let m;
  while((m=re.exec(xml))){
    if(news.some(n=>n.endsWith(m[1])||m[1].endsWith(n))){
      out.push("- "+m[2].replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&"));
    }
  }
  console.log(out.join("\n"));
} catch(e){}
' "$XML" "${NEW_TESTS[@]}")

{
  echo "# Test evidence ($LABEL)"
  echo
  echo "- Affected package: \`$PKG_NAME\`"
  echo "- Test scope: \`$SCOPE\`"
  echo "- Result: $([ "$VERDICT" = true ] && echo PASSED || echo FAILED)"
  echo "- Totals: $TOTALS_LINE"
  echo "- Gate attempts used: $attempt of $MAX_ATTEMPTS"
  echo
  echo "## New tests"
  if [ -n "$NEW_LIST" ]; then echo "$NEW_LIST"; else echo "_(none detected among changed files)_"; fi
} > "$OUT/summary.md"

{
  echo "TESTS_PASSED=$VERDICT"
  echo "TESTS_TOTAL=$TOTAL_ENV"
  echo "TESTS_FAILED=$FAILED_ENV"
  echo "TESTS_PKG=$PKG_NAME"
  echo "EVIDENCE_DIR=$OUT"
} >> "$GITHUB_ENV"

{
  echo "### Test gate ($LABEL): $([ "$VERDICT" = true ] && echo '✅ PASSED' || echo '❌ FAILED')"
  echo "- \`$PKG_NAME\` scope \`$SCOPE\`: $TOTALS_LINE (attempts: $attempt)"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

echo "Gate verdict: TESTS_PASSED=$VERDICT ($TOTALS_LINE)"
exit 0
