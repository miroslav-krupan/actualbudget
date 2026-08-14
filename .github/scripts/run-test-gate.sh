#!/usr/bin/env bash
#
# Deterministic test gate with an external fix loop.
#
# The LLM has already implemented and self-verified to green. This gate is the
# SOURCE OF TRUTH: it runs the affected package's FULL suite itself and decides
# pass/fail from vitest's real exit code + the JUnit failure/error counts —
# never the LLM's word. If the deterministic run disagrees with the LLM (rare),
# it feeds the real failure back to the LLM to fix and re-runs, up to
# MAX_GATE_ATTEMPTS (default 3). Evidence from the final run is committed by the
# caller.
#
# Usage: bash run-test-gate.sh <spec_dir> <label>
# Env:   COPILOT_GITHUB_TOKEN (for the in-loop fix), MAX_GATE_ATTEMPTS (opt).
# Emits to $GITHUB_ENV: TESTS_PASSED, TESTS_TOTAL, TESTS_FAILED, TESTS_PKG,
#         EVIDENCE_DIR. Writes evidence to <spec_dir>/test-results/<label>/.

SPEC_DIR="$1"
LABEL="$2"
MAX_ATTEMPTS="${MAX_GATE_ATTEMPTS:-3}"
OUT="$SPEC_DIR/test-results/$LABEL"
mkdir -p "$OUT"
XML="$PWD/$OUT/junit.xml"
LOG="$PWD/$OUT/console.log"

# Determine the affected package and the new test files from the LLM's changes.
NEW_TESTS=()
PKG=""
while IFS= read -r line; do
  f=$(printf '%s' "$line" | sed 's/^...//; s/^"//; s/"$//')
  [ -z "$f" ] && continue
  case "$f" in
    *.test.ts|*.test.tsx|*.test.js|*.spec.ts|*.spec.tsx|*.spec.js) NEW_TESTS+=("$f") ;;
  esac
  case "$f" in
    packages/*) [ -z "$PKG" ] && PKG=$(printf '%s' "$f" | cut -d/ -f1-2) ;;
  esac
done < <(git status --porcelain)

if [ -z "$PKG" ]; then
  echo "::error::Could not determine the affected package from the changes."
  echo "TESTS_PASSED=false" >> "$GITHUB_ENV"
  exit 0
fi

PKG_NAME=$(node -p "require('./$PKG/package.json').name")
ENVV=""
[ "$PKG_NAME" = "@actual-app/core" ] && ENVV="ENV=node"
echo "Affected package: $PKG ($PKG_NAME)"
echo "New test files: ${NEW_TESTS[*]:-none}"

# Run the full package suite once; sets RC, TOTAL, FAILS, ERRS.
run_suite() {
  yarn workspace "$PKG_NAME" exec env $ENVV vitest run \
    --reporter=junit --outputFile="$XML" > "$LOG" 2>&1
  RC=$?
  local counts
  counts=$(node -e '
    const fs=require("fs");
    try {
      const s=fs.readFileSync(process.argv[1],"utf8");
      const m=s.match(/<testsuites\b[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"[^>]*\berrors="(\d+)"/);
      console.log(m ? `${m[1]} ${m[2]} ${m[3]}` : "0 1 0");
    } catch(e){ console.log("0 1 0"); }
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
  if [ "$RC" -eq 0 ] && [ "$FAILS" -eq 0 ] && [ "$ERRS" -eq 0 ]; then
    VERDICT=true
    break
  fi
  # Deterministic run disagrees with the LLM. Feed the real failure back,
  # unless this was the last attempt.
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "Gate failed; asking the LLM to fix and re-running."
    FAILTAIL=$(tail -80 "$LOG")
    copilot --allow-all-tools -p "The deterministic full test suite for \
    package ${PKG_NAME} failed, even though you reported it green. Fix the \
    code or the tests so the ENTIRE suite passes. Do not weaken or delete \
    tests to force a pass, and do NOT run git or gh. Failing output (tail):

    ${FAILTAIL}"
  fi
  attempt=$((attempt + 1))
done

PASSED=$(( TOTAL - FAILS - ERRS ))

# New-test names from JUnit testcases belonging to the changed files.
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
  echo "- Result: $([ "$VERDICT" = true ] && echo PASSED || echo FAILED)"
  echo "- Totals: $PASSED passed, $FAILS failed, $ERRS errors (of $TOTAL)"
  echo "- Gate attempts used: $attempt of $MAX_ATTEMPTS"
  echo
  echo "## New tests"
  if [ -n "$NEW_LIST" ]; then echo "$NEW_LIST"; else echo "_(none detected among changed files)_"; fi
} > "$OUT/summary.md"

{
  echo "TESTS_PASSED=$VERDICT"
  echo "TESTS_TOTAL=$TOTAL"
  echo "TESTS_FAILED=$((FAILS+ERRS))"
  echo "TESTS_PKG=$PKG_NAME"
  echo "EVIDENCE_DIR=$OUT"
} >> "$GITHUB_ENV"

{
  echo "### Test gate ($LABEL): $([ "$VERDICT" = true ] && echo '✅ PASSED' || echo '❌ FAILED')"
  echo "- Package \`$PKG_NAME\`: $PASSED passed, $FAILS failed, $ERRS errors (attempts: $attempt)"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

echo "Gate verdict: TESTS_PASSED=$VERDICT ($PASSED/$TOTAL passed)"
exit 0
