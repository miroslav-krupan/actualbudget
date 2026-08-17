## Test evidence (impl)

- Affected package: `@actual-app/core`
- Test scope: `src/shared`
- Result: PASSED (vitest exit code 0)
- New tests: 5 (all passed)
- Regression: full scoped suite `src/shared` green
- Gate attempts used: 1 of 3

### New tests (5)
1. ✅ rounds previously-affected values to the nearest cent instead of flooring
2. ✅ leaves already-correct values unaffected
3. ✅ applies the same rounding to negative amounts
4. ✅ rounds exact halfway ties toward positive infinity
5. ✅ respects a non-default decimalPlaces parameter
