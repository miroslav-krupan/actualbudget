## Test evidence (impl)

- Affected package: `@actual-app/core`
- Test scope: `src/shared`
- Result: PASSED (vitest exit code 0)
- New tests: 5 (all passed)
- Regression: full scoped suite `src/shared` green
- Gate attempts used: 1 of 3

### New tests (5)
1. ✅ rounds amounts affected by floating-point imprecision to the nearest cent
2. ✅ continues to correctly convert amounts unaffected by the bug
3. ✅ correctly rounds negative amounts, preserving sign
4. ✅ rounds exact halfway values away from zero
5. ✅ generalizes to a non-default number of decimal places
