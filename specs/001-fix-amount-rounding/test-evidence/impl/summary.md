## Test evidence (impl)

- Affected package: `@actual-app/core`
- Test scope: `src/shared`
- Result: PASSED (vitest exit code 0)
- New tests: 3 (all passed)
- Regression: full scoped suite `src/shared` green
- Gate attempts used: 1 of 3

### New tests (3)
1. ✅ rounds previously-affected values to the nearest cent
2. ✅ keeps previously-unaffected values correct
3. ✅ rounds halfway values up in magnitude
