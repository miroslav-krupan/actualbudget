#!/usr/bin/env bash
#
# Deterministic test gate. Runs the affected package's full test suite, captures
# auditable evidence (JUnit XML + console log + a human-readable summary), and
# reports the verdict to later workflow steps via $GITHUB_ENV.
#
# The verdict is vitest's real exit code + the JUnit failure/error counts —
# never the LLM's word. Always exits 0; the caller decides what to do with
# TESTS_PASSED (so evidence is committed even on failure).
#
# Usage: bash run-test-gate.sh <spec_dir> <label>
#
# Emits to $GITHUB_ENV: TESTS_PASSED, TESTS_TOTAL, TESTS_FAILED, TESTS_PKG,
# EVIDENCE_DIR. Writes evidence to <spec_dir>/test-results/<label>/.

SPEC_DIR="$1"
LABEL="$2"
OUT="$SPEC_DIR/test-results/$LABEL"
mkdir -p "$OUT"
XML="$PWD/$OUT/junit.xml"
LOG="$PWD/$OUT/console.log"

# Collect changed files (the LLM's uncommitted work). Identify the new test
# files and the affected package.
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
# loot-core's suite requires an ENV; 'node' covers the server/logic tests.
ENVV=""
[ "$PKG_NAME" = "@actual-app/core" ] && ENVV="ENV=node"

echo "Affected package: $PKG ($PKG_NAME)"
echo "New test files: ${NEW_TESTS[*]:-none}"

# Run the FULL package suite with a JUnit reporter. Verdict = exit code.
yarn workspace "$PKG_NAME" exec env $ENVV vitest run \
  --reporter=junit --outputFile="$XML" > "$LOG" 2>&1
RC=$?
echo "vitest exit code: $RC"
tail -8 "$LOG" 2>/dev/null || true

# Aggregate counts from the JUnit root element.
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
PASSED=$(( TOTAL - FAILS - ERRS ))

if [ "$RC" -eq 0 ] && [ "$FAILS" -eq 0 ] && [ "$ERRS" -eq 0 ]; then
  VERDICT=true
else
  VERDICT=false
fi

# New-test names, pulled from JUnit testcases belonging to the changed files.
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

# Human-readable, committed evidence summary.
{
  echo "# Test evidence ($LABEL)"
  echo
  echo "- Affected package: \`$PKG_NAME\`"
  echo "- Result: $([ "$VERDICT" = true ] && echo PASSED || echo FAILED)"
  echo "- Totals: $PASSED passed, $FAILS failed, $ERRS errors (of $TOTAL)"
  echo "- vitest exit code: $RC"
  echo
  echo "## New tests"
  if [ -n "$NEW_LIST" ]; then echo "$NEW_LIST"; else echo "_(none detected among changed files)_"; fi
} > "$OUT/summary.md"

# Report to later steps.
{
  echo "TESTS_PASSED=$VERDICT"
  echo "TESTS_TOTAL=$TOTAL"
  echo "TESTS_FAILED=$((FAILS+ERRS))"
  echo "TESTS_PKG=$PKG_NAME"
  echo "EVIDENCE_DIR=$OUT"
} >> "$GITHUB_ENV"

# Job summary (auditable at a glance on the run page).
{
  echo "### Test gate ($LABEL): $([ "$VERDICT" = true ] && echo '✅ PASSED' || echo '❌ FAILED')"
  echo "- Package \`$PKG_NAME\`: $PASSED passed, $FAILS failed, $ERRS errors"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

echo "Gate verdict: TESTS_PASSED=$VERDICT ($PASSED/$TOTAL passed)"
exit 0
